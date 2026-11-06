// Copyright 2023-2026 Lightpanda (Selecy SAS)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//	http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// layoutdraw loads a page in the browser, reads the box, colors and text of
// each element, and draws a PNG from that data only.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"log"
	"log/slog"
	"math"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"unicode"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/css"
	"github.com/chromedp/cdproto/dom"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/gobolditalic"
	"golang.org/x/image/font/gofont/goitalic"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"golang.org/x/sync/errgroup"
)

const (
	exitOK   = 0
	exitFail = 1

	maxHeight = 10000
)

const (
	CdpWSDefault = "ws://127.0.0.1:9222"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := run(ctx, os.Args, os.Stdout, os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(exitFail)
	}

	os.Exit(exitOK)
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose  = flags.Bool("verbose", false, "enable debug log level")
		cdpws    = flags.String("cdp", env("CDPCLI_WS", CdpWSDefault), "cdp ws to connect")
		out      = flags.String("o", "", "output PNG file (default stdout)")
		outlines = flags.Bool("outlines", true, "draw element outlines, colored by depth")
		labels   = flags.Bool("labels", true, "draw tag#id labels on boxes without text")
		full     = flags.Bool("full", false, "draw the whole page instead of the viewport only")
	)

	exec := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s [options] <url>\n", exec)
		fmt.Fprintf(stderr, "layoutdraw draws a PNG from the element boxes computed by the browser.\n")
		fmt.Fprintf(stderr, "\nCommand line options:\n")
		flags.PrintDefaults()
		fmt.Fprintf(stderr, "\nEnvironment vars:\n")
		fmt.Fprintf(stderr, "\tCDPCLI_WS\tdefault %s\n", CdpWSDefault)
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	if *verbose {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}

	args = flags.Args()
	if len(args) != 1 {
		flags.Usage()
		return errors.New("missing url")
	}
	url := args[0]

	ctx, cancel := chromedp.NewRemoteAllocator(ctx,
		*cdpws, chromedp.NoModifyURL,
	)
	defer cancel()

	var opts []chromedp.ContextOption
	if *verbose {
		opts = append(opts, chromedp.WithDebugf(log.Printf))
	}
	ctx, cancel = chromedp.NewContext(ctx, opts...)
	defer cancel()

	var l Layout
	err := chromedp.Run(ctx,
		chromedp.Navigate(url),
		chromedp.ActionFunc(func(ctx context.Context) error {
			var err error
			l, err = collect(ctx)
			return err
		}),
	)
	if err != nil {
		return fmt.Errorf("collect boxes: %w", err)
	}

	w := stdout
	if *out != "" {
		f, err := os.Create(*out)
		if err != nil {
			return fmt.Errorf("create output: %w", err)
		}
		defer f.Close()
		w = f
	}

	img, err := drawLayout(l, drawOpts{outlines: *outlines, labels: *labels, full: *full})
	if err != nil {
		return err
	}
	return png.Encode(w, img)
}

// Box is one element or text node, in page coordinates.
type Box struct {
	// "el": any element, "img": replaced element (img, svg, canvas...),
	// "field": input, textarea or select, "text": a text node.
	Kind  string
	Tag   string
	ID    string
	Depth int
	X     float64
	Y     float64
	W     float64
	H     float64

	Bg      string
	Border  []Border // top, right, bottom, left
	HasText bool

	Color    string
	FontSize float64
	Bold     bool
	Italic   bool

	Alt         string
	InputType   string
	Value       string
	Placeholder string
	Checked     bool

	// Text node only: the text, and one box per line as laid out by the
	// browser. When the browser gives no line boxes, the text is wrapped
	// inside Area, the content box of the parent element.
	Text  string
	Lines []Rect
	Area  Rect
}

type Border struct {
	W float64
	C string
}

type Rect struct {
	X, Y, W, H float64
}

func (r Rect) empty() bool { return r.W <= 0 || r.H <= 0 }

type Layout struct {
	// Whole page size.
	Width  float64
	Height float64
	// Visible part of the page, in page coordinates.
	Viewport Rect

	PageBg []string
	Boxes  []Box
}

var (
	skipTags     = set("head", "script", "style", "noscript", "template", "title", "meta", "link", "base")
	replacedTags = set("img", "svg", "canvas", "video", "iframe", "object", "embed")
	fieldTags    = set("input", "textarea", "select")
)

func set(names ...string) map[string]bool {
	m := map[string]bool{}
	for _, n := range names {
		m[n] = true
	}
	return m
}

// item is a node to measure, in document order.
type item struct {
	node   *cdp.Node
	parent int // index of the parent element item, -1 for none
	depth  int
}

// geom is what the browser returns for one item.
type geom struct {
	ok      bool // the node has a box
	border  Rect
	content Rect
	lines   []Rect            // text nodes: one box per line
	style   map[string]string // nil when the browser has no computed styles
}

// collect reads the layout of the current page with CDP calls only:
// Page.getLayoutMetrics, DOM.getDocument, DOM.getBoxModel,
// DOM.getContentQuads and CSS.getComputedStyleForNode.
func collect(ctx context.Context) (Layout, error) {
	var l Layout

	_, _, _, vp, _, size, err := page.GetLayoutMetrics().Do(ctx)
	if err != nil {
		return l, fmt.Errorf("get layout metrics: %w", err)
	}
	l.Viewport = Rect{float64(vp.PageX), float64(vp.PageY), float64(vp.ClientWidth), float64(vp.ClientHeight)}
	l.Width, l.Height = size.Width, size.Height

	root, err := dom.GetDocument().WithDepth(-1).WithPierce(true).Do(ctx)
	if err != nil {
		return l, fmt.Errorf("get document: %w", err)
	}

	var items []item
	flatten(root, -1, 0, &items)

	// One call per node: run them in parallel.
	geoms := make([]geom, len(items))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(16)
	for i := range items {
		g.Go(func() error {
			geoms[i] = measure(gctx, items[i].node)
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return l, err
	}
	if err := ctx.Err(); err != nil {
		return l, err
	}

	styles, err := fetchStyles(ctx, root, items)
	if err != nil {
		return l, err
	}
	for i := range geoms {
		geoms[i].style = styles[i]
	}

	// Quads are relative to the viewport: move them to page coordinates.
	offset := func(r Rect) Rect {
		r.X += l.Viewport.X
		r.Y += l.Viewport.Y
		return r
	}

	hidden := make([]bool, len(items))
	for i, it := range items {
		if it.parent >= 0 && hidden[it.parent] {
			hidden[i] = true
			continue
		}
		n, gm := it.node, geoms[i]

		if n.NodeType == cdp.NodeTypeText {
			var ps map[string]string
			var area Rect
			if it.parent >= 0 {
				ps = geoms[it.parent].style
				area = offset(geoms[it.parent].content)
			}
			if ps != nil && ps["visibility"] != "visible" {
				continue
			}
			text := transform(normalize(n.NodeValue), ps["text-transform"])
			// Keep one leading space: the browser line box starts with it.
			if strings.TrimLeftFunc(n.NodeValue, unicode.IsSpace) != n.NodeValue {
				text = " " + text
			}
			b := Box{Kind: "text", Depth: it.depth, Text: text, Area: area}
			for _, r := range gm.lines {
				b.Lines = append(b.Lines, offset(r))
			}
			if len(b.Lines) == 0 && area.empty() {
				continue
			}
			setFont(&b, ps)
			l.Boxes = append(l.Boxes, b)
			continue
		}

		st := gm.style
		if st != nil && (st["display"] == "none" || st["opacity"] == "0") {
			hidden[i] = true
			continue
		}
		tag := strings.ToLower(n.LocalName)
		if tag == "input" && strings.EqualFold(attr(n, "type"), "hidden") {
			continue
		}
		switch tag {
		case "html":
			l.PageBg = append([]string{st["background-color"]}, l.PageBg...)
		case "body":
			l.PageBg = append(l.PageBg, st["background-color"])
		}
		// No box (display: contents, unslotted...) or hidden box: skip it,
		// but its children may still be drawn.
		if !gm.ok || gm.border.empty() {
			continue
		}
		if st != nil && st["visibility"] != "visible" {
			continue
		}

		r := offset(gm.border)
		b := Box{
			Kind: "el", Tag: tag, ID: attr(n, "id"), Depth: it.depth,
			X: r.X, Y: r.Y, W: r.W, H: r.H,
			Bg: st["background-color"], Border: borders(st),
		}
		setFont(&b, st)
		for _, c := range n.Children {
			if c.NodeType == cdp.NodeTypeText && strings.TrimSpace(c.NodeValue) != "" {
				b.HasText = true
			}
		}

		switch {
		case n.PseudoType != "":
			b.Tag = "::" + string(n.PseudoType)
			text := contentText(st["content"])
			b.HasText = text != ""
			l.Boxes = append(l.Boxes, b)
			if text != "" {
				t := Box{Kind: "text", Depth: it.depth + 1, Text: text, Lines: []Rect{offset(gm.content)}}
				setFont(&t, st)
				l.Boxes = append(l.Boxes, t)
			}
			continue
		case replacedTags[tag]:
			b.Kind = "img"
			b.Alt = firstOf(attr(n, "alt"), attr(n, "aria-label"), attr(n, "title"), tag)
		case fieldTags[tag]:
			b.Kind = "field"
			setField(&b, n)
		}
		l.Boxes = append(l.Boxes, b)
	}

	return l, nil
}

// flatten lists the nodes to measure in document order.
func flatten(n *cdp.Node, parent, depth int, items *[]item) {
	switch n.NodeType {
	case cdp.NodeTypeDocument, cdp.NodeTypeDocumentFragment:
		for _, c := range n.Children {
			flatten(c, parent, depth, items)
		}

	case cdp.NodeTypeText:
		if strings.TrimSpace(n.NodeValue) != "" {
			*items = append(*items, item{n, parent, depth})
		}

	case cdp.NodeTypeElement:
		tag := strings.ToLower(n.LocalName)
		if skipTags[tag] {
			return
		}
		idx := len(*items)
		*items = append(*items, item{n, parent, depth})
		// Images and form fields are drawn as one box: skip their content.
		if replacedTags[tag] || fieldTags[tag] {
			return
		}
		pseudo := func(t cdp.PseudoType) {
			for _, p := range n.PseudoElements {
				if p.PseudoType == t {
					*items = append(*items, item{p, idx, depth + 1})
				}
			}
		}
		pseudo(cdp.PseudoTypeBefore)
		for _, sr := range n.ShadowRoots {
			flatten(sr, idx, depth+1, items)
		}
		for _, c := range n.Children {
			flatten(c, idx, depth+1, items)
		}
		pseudo(cdp.PseudoTypeAfter)
	}
}

// fetchStyles reads the computed styles of all elements. It returns nil
// styles when the browser does not support CSS.getComputedStyleForNode.
//
// That call only takes a nodeId, and nodeIds change each time someone calls
// DOM.getDocument (chromedp does it after a navigation). When the ids are
// stale, fetch the tree again and retry.
func fetchStyles(ctx context.Context, root *cdp.Node, items []item) ([]map[string]string, error) {
	styles := make([]map[string]string, len(items))
	_ = css.Enable().Do(ctx)

	for attempt := 1; ; attempt++ {
		ids := nodeIDs(root, map[cdp.BackendNodeID]cdp.NodeID{})
		var stale atomic.Bool

		get := func(i int) error {
			id := ids[items[i].node.BackendNodeID]
			if id == 0 {
				stale.Store(true)
				return nil
			}
			props, _, err := css.GetComputedStyleForNode(id).Do(ctx)
			if err != nil {
				if strings.Contains(err.Error(), "find node") {
					stale.Store(true)
				}
				return err
			}
			st := make(map[string]string, len(props))
			for _, p := range props {
				st[p.Name] = p.Value
			}
			styles[i] = st
			return nil
		}

		// Try one element first: an error that is not about a stale id
		// means the browser has no computed styles.
		first := slices.IndexFunc(items, func(it item) bool { return it.node.NodeType == cdp.NodeTypeElement })
		if first < 0 {
			return styles, nil
		}
		if err := get(first); err != nil && !stale.Load() {
			return make([]map[string]string, len(items)), nil
		}

		if !stale.Load() {
			g, _ := errgroup.WithContext(ctx)
			g.SetLimit(16)
			for i := first + 1; i < len(items); i++ {
				if items[i].node.NodeType == cdp.NodeTypeElement {
					g.Go(func() error { _ = get(i); return nil })
				}
			}
			_ = g.Wait()
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !stale.Load() || attempt == 3 {
			return styles, nil
		}

		var err error
		root, err = dom.GetDocument().WithDepth(-1).WithPierce(true).Do(ctx)
		if err != nil {
			return nil, fmt.Errorf("get document: %w", err)
		}
	}
}

// nodeIDs maps the stable backend ids to the current nodeIds.
func nodeIDs(n *cdp.Node, m map[cdp.BackendNodeID]cdp.NodeID) map[cdp.BackendNodeID]cdp.NodeID {
	m[n.BackendNodeID] = n.NodeID
	for _, list := range [][]*cdp.Node{n.Children, n.ShadowRoots, n.PseudoElements} {
		for _, c := range list {
			nodeIDs(c, m)
		}
	}
	return m
}

// measure asks the browser for the boxes of one node. It uses the backend
// id, which stays valid when nodeIds change. Errors mean the node has no
// box: they are not fatal.
func measure(ctx context.Context, n *cdp.Node) geom {
	var g geom

	if n.NodeType == cdp.NodeTypeText {
		quads, err := dom.GetContentQuads().WithBackendNodeID(n.BackendNodeID).Do(ctx)
		if err != nil {
			return g
		}
		for _, q := range quads {
			if r := quadRect(q); !r.empty() {
				g.lines = append(g.lines, r)
			}
		}
		g.ok = len(g.lines) > 0
		return g
	}

	if bm, err := dom.GetBoxModel().WithBackendNodeID(n.BackendNodeID).Do(ctx); err == nil {
		g.ok = true
		g.border = quadRect(bm.Border)
		g.content = quadRect(bm.Content)
	}
	return g
}

// quadRect returns the bounding rectangle of a quad (x1,y1 ... x4,y4).
func quadRect(q dom.Quad) Rect {
	if len(q) < 8 {
		return Rect{}
	}
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	for i := 0; i+1 < len(q); i += 2 {
		minX, maxX = min(minX, q[i]), max(maxX, q[i])
		minY, maxY = min(minY, q[i+1]), max(maxY, q[i+1])
	}
	return Rect{minX, minY, maxX - minX, maxY - minY}
}

func borders(st map[string]string) []Border {
	if st == nil {
		return nil
	}
	var bs []Border
	for _, side := range []string{"top", "right", "bottom", "left"} {
		switch st["border-"+side+"-style"] {
		case "none", "hidden", "":
			bs = append(bs, Border{})
		default:
			bs = append(bs, Border{W: px(st["border-"+side+"-width"]), C: st["border-"+side+"-color"]})
		}
	}
	return bs
}

// setFont copies the text styles. Without styles, the defaults stay.
func setFont(b *Box, st map[string]string) {
	b.FontSize = 16
	if st == nil {
		return
	}
	b.Color = st["color"]
	if v := px(st["font-size"]); v > 0 {
		b.FontSize = v
	}
	w, _ := strconv.Atoi(st["font-weight"])
	b.Bold = w >= 600 || st["font-weight"] == "bold"
	b.Italic = st["font-style"] != "" && st["font-style"] != "normal"
}

// setField reads a form field state from its attributes.
func setField(b *Box, n *cdp.Node) {
	switch b.Tag {
	case "select":
		b.InputType = "select"
		var first, selected string
		var walk func(*cdp.Node)
		walk = func(c *cdp.Node) {
			if strings.EqualFold(c.LocalName, "option") {
				text := normalize(nodeText(c))
				if first == "" {
					first = text
				}
				if hasAttr(c, "selected") && selected == "" {
					selected = text
				}
				return
			}
			for _, cc := range c.Children {
				walk(cc)
			}
		}
		walk(n)
		b.Value = firstOf(selected, first)
	case "textarea":
		b.InputType = "textarea"
		b.Value = nodeText(n)
		b.Placeholder = attr(n, "placeholder")
	default:
		b.InputType = strings.ToLower(firstOf(attr(n, "type"), "text"))
		switch b.InputType {
		case "checkbox", "radio":
			b.Checked = hasAttr(n, "checked")
		case "submit", "button", "reset":
			dflt := "Submit"
			if b.InputType == "reset" {
				dflt = "Reset"
			}
			b.Value = firstOf(attr(n, "value"), dflt)
		case "password":
			b.Value = strings.Repeat("*", len(attr(n, "value")))
			b.Placeholder = attr(n, "placeholder")
		default:
			b.Value = attr(n, "value")
			b.Placeholder = attr(n, "placeholder")
		}
	}
}

func attr(n *cdp.Node, name string) string {
	for i := 0; i+1 < len(n.Attributes); i += 2 {
		if strings.EqualFold(n.Attributes[i], name) {
			return n.Attributes[i+1]
		}
	}
	return ""
}

func hasAttr(n *cdp.Node, name string) bool {
	for i := 0; i < len(n.Attributes); i += 2 {
		if strings.EqualFold(n.Attributes[i], name) {
			return true
		}
	}
	return false
}

func nodeText(n *cdp.Node) string {
	if n.NodeType == cdp.NodeTypeText {
		return n.NodeValue
	}
	var sb strings.Builder
	for _, c := range n.Children {
		sb.WriteString(nodeText(c))
	}
	return sb.String()
}

func firstOf(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func normalize(s string) string { return strings.Join(strings.Fields(s), " ") }

func transform(s, tt string) string {
	switch tt {
	case "uppercase":
		return strings.ToUpper(s)
	case "lowercase":
		return strings.ToLower(s)
	case "capitalize":
		words := strings.Fields(s)
		for i, w := range words {
			r := []rune(w)
			r[0] = unicode.ToUpper(r[0])
			words[i] = string(r)
		}
		return strings.Join(words, " ")
	}
	return s
}

// contentText reads the CSS content of a pseudo-element: only plain
// strings like "→" are kept.
func contentText(c string) string {
	if len(c) < 2 || c[0] != '"' {
		return ""
	}
	if s, err := strconv.Unquote(c); err == nil {
		return s
	}
	return strings.Trim(c, `"`)
}

// px parses a CSS pixel value like "16px".
func px(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(s), "px"), 64)
	return v
}

type drawOpts struct {
	outlines bool
	labels   bool
	full     bool
}

// palette gives each nesting depth its own outline color.
var palette = []color.NRGBA{
	{0x1f, 0x77, 0xb4, 0xff},
	{0xff, 0x7f, 0x0e, 0xff},
	{0x2c, 0xa0, 0x2c, 0xff},
	{0xd6, 0x27, 0x28, 0xff},
	{0x94, 0x67, 0xbd, 0xff},
	{0x8c, 0x56, 0x4b, 0xff},
	{0xe3, 0x77, 0xc2, 0xff},
	{0x17, 0xbe, 0xcf, 0xff},
}

var (
	gray      = color.NRGBA{0x88, 0x88, 0x88, 0xff}
	lightGray = color.NRGBA{0xe4, 0xe4, 0xe4, 0xff}
)

func drawLayout(l Layout, o drawOpts) (*image.RGBA, error) {
	fonts, err := newFonts()
	if err != nil {
		return nil, err
	}

	// The image bounds are in page coordinates, so boxes need no shift:
	// anything outside the bounds is clipped when drawing.
	var bounds image.Rectangle
	if o.full {
		w := max(int(math.Ceil(l.Width)), 1)
		h := min(max(int(math.Ceil(l.Height)), 1), maxHeight)
		bounds = image.Rect(0, 0, w, h)
	} else {
		v := l.Viewport
		bounds = rectOf(v.X, v.Y, max(v.W, 1), max(v.H, 1))
	}

	img := image.NewRGBA(bounds)
	draw.Draw(img, img.Bounds(), image.White, image.Point{}, draw.Src)

	// The page background comes from html, or from body when html has none.
	for _, s := range l.PageBg {
		if c, ok := parseColor(s); ok && c.A > 0 {
			fill(img, img.Bounds(), c)
			break
		}
	}

	for _, b := range l.Boxes {
		if b.Kind == "text" {
			drawText(img, fonts, b)
			continue
		}

		r := rectOf(b.X, b.Y, b.W, b.H)
		if c, ok := parseColor(b.Bg); ok {
			fill(img, r, c)
		}
		drawBorders(img, r, b.Border)

		switch b.Kind {
		case "img":
			drawReplaced(img, r, b)
		case "field":
			drawField(img, fonts, r, b)
		}

		if o.outlines {
			c := palette[b.Depth%len(palette)]
			c.A = 0x80
			outline(img, r, c)
		}
		if o.labels && b.Kind == "el" && !b.HasText {
			drawLabel(img, r, b)
		}
	}

	return img, nil
}

func rectOf(x, y, w, h float64) image.Rectangle {
	return image.Rect(int(math.Round(x)), int(math.Round(y)),
		int(math.Round(x+w)), int(math.Round(y+h)))
}

// fill blends c over r.
func fill(img *image.RGBA, r image.Rectangle, c color.NRGBA) {
	if c.A == 0 {
		return
	}
	draw.Draw(img, r, image.NewUniform(c), image.Point{}, draw.Over)
}

func outline(img *image.RGBA, r image.Rectangle, c color.NRGBA) {
	if r.Dx() < 2 || r.Dy() < 2 {
		return
	}
	fill(img, image.Rect(r.Min.X, r.Min.Y, r.Max.X, r.Min.Y+1), c)
	fill(img, image.Rect(r.Min.X, r.Max.Y-1, r.Max.X, r.Max.Y), c)
	fill(img, image.Rect(r.Min.X, r.Min.Y+1, r.Min.X+1, r.Max.Y-1), c)
	fill(img, image.Rect(r.Max.X-1, r.Min.Y+1, r.Max.X, r.Max.Y-1), c)
}

// drawBorders draws each side with its own width and color.
func drawBorders(img *image.RGBA, r image.Rectangle, bs []Border) {
	if len(bs) != 4 {
		return
	}
	width := func(b Border) int {
		if b.W <= 0 {
			return 0
		}
		return max(int(math.Round(b.W)), 1)
	}
	t, rt, bt, lt := width(bs[0]), width(bs[1]), width(bs[2]), width(bs[3])
	sides := []struct {
		b Border
		r image.Rectangle
	}{
		{bs[0], image.Rect(r.Min.X, r.Min.Y, r.Max.X, r.Min.Y+t)},
		{bs[1], image.Rect(r.Max.X-rt, r.Min.Y+t, r.Max.X, r.Max.Y-bt)},
		{bs[2], image.Rect(r.Min.X, r.Max.Y-bt, r.Max.X, r.Max.Y)},
		{bs[3], image.Rect(r.Min.X, r.Min.Y+t, r.Min.X+lt, r.Max.Y-bt)},
	}
	for _, s := range sides {
		if c, ok := parseColor(s.b.C); ok && !s.r.Empty() {
			fill(img, s.r, c)
		}
	}
}

// drawText draws a text node. With line boxes from the browser, the words
// are split across them by width; otherwise the text wraps inside Area.
func drawText(img *image.RGBA, fonts *fonts, b Box) {
	c, ok := parseColor(b.Color)
	if !ok {
		c = color.NRGBA{0, 0, 0, 0xff}
	}
	src := image.NewUniform(c)
	face := fonts.face(b.Bold, b.Italic, b.FontSize)
	words := strings.Fields(b.Text)

	if len(b.Lines) > 0 {
		for i, ws := range splitLines(face, words, b.Lines) {
			text := strings.Join(ws, " ")
			// A line at the left edge of its container never starts with a space.
			if i == 0 && strings.HasPrefix(b.Text, " ") && b.Lines[0].X > b.Area.X+0.5 {
				text = " " + text
			}
			drawLine(img, fonts, src, b, b.Lines[i], text)
		}
		return
	}

	// No line boxes: wrap the words inside the parent content box.
	area := rectOf(b.Area.X, b.Area.Y, b.Area.W, b.Area.H)
	clip, ok := img.SubImage(area).(*image.RGBA)
	if !ok || clip.Bounds().Empty() {
		return
	}
	lineH := math.Ceil(b.FontSize * 1.2)
	y := b.Area.Y
	line := ""
	flush := func() {
		if line != "" {
			drawLine(clip, fonts, src, b, Rect{b.Area.X, y, b.Area.W, lineH}, line)
			y += lineH
			line = ""
		}
	}
	for _, w := range words {
		next := w
		if line != "" {
			next = line + " " + w
		}
		if line != "" && float64(font.MeasureString(face, next).Round()) > b.Area.W {
			flush()
			next = w
		}
		line = next
	}
	flush()
}

// splitLines gives each line box its share of the words. Our font is not
// the page font, so word widths are scaled to the total width of the lines.
func splitLines(face font.Face, words []string, lines []Rect) [][]string {
	out := make([][]string, len(lines))
	if len(words) == 0 {
		return out
	}
	space := float64(font.MeasureString(face, " ").Round())
	ws := make([]float64, len(words))
	total := space * float64(len(words)-1)
	for i, w := range words {
		ws[i] = float64(font.MeasureString(face, w).Round())
		total += ws[i]
	}
	lineTotal := 0.0
	for _, l := range lines {
		lineTotal += l.W
	}
	scale := 1.0
	if total > 0 && lineTotal > 0 {
		scale = lineTotal / total
	}

	wi := 0
	for li, l := range lines {
		if li == len(lines)-1 {
			out[li] = words[wi:]
			break
		}
		budget, acc := l.W/scale, 0.0
		for wi < len(words) {
			w := ws[wi]
			if acc > 0 {
				w += space
			}
			// Keep the word when at least half of it fits.
			if len(out[li]) > 0 && acc+w/2 > budget {
				break
			}
			out[li] = append(out[li], words[wi])
			acc += w
			wi++
		}
	}
	return out
}

// drawLine draws text in a line box, shrunk when it is wider than the box.
func drawLine(img *image.RGBA, fonts *fonts, src image.Image, b Box, r Rect, text string) {
	if text == "" {
		return
	}
	face := fonts.face(b.Bold, b.Italic, b.FontSize)
	if adv := font.MeasureString(face, text).Round(); adv > 0 && float64(adv) > r.W*1.05 {
		face = fonts.face(b.Bold, b.Italic, b.FontSize*r.W/float64(adv))
	}
	m := face.Metrics()
	asc, desc := m.Ascent.Round(), m.Descent.Round()
	baseline := int(math.Round(r.Y + (r.H+float64(asc-desc))/2))
	d := font.Drawer{Dst: img, Src: src, Face: face, Dot: fixed.P(int(math.Round(r.X)), baseline)}
	d.DrawString(text)
}

// drawReplaced draws an image placeholder: gray box, a cross and the alt text.
func drawReplaced(img *image.RGBA, r image.Rectangle, b Box) {
	if c, ok := parseColor(b.Bg); !ok || c.A == 0 {
		fill(img, r, lightGray)
	}
	line(img, r.Min.X, r.Min.Y, r.Max.X-1, r.Max.Y-1, gray)
	line(img, r.Min.X, r.Max.Y-1, r.Max.X-1, r.Min.Y, gray)
	outline(img, r, gray)

	clip := img.SubImage(r).(*image.RGBA)
	tw := 7 * len(b.Alt)
	x := r.Min.X + max((r.Dx()-tw)/2, 2)
	y := r.Min.Y + r.Dy()/2 + 4
	fill(clip, image.Rect(x-2, y-11, x+tw+2, y+3), color.NRGBA{0xff, 0xff, 0xff, 0xc0})
	drawSmall(clip, x, y, b.Alt, color.NRGBA{0x44, 0x44, 0x44, 0xff})
}

// drawField draws the value, placeholder or check mark of a form field.
func drawField(img *image.RGBA, fonts *fonts, r image.Rectangle, b Box) {
	fg, ok := parseColor(b.Color)
	if !ok {
		fg = color.NRGBA{0, 0, 0, 0xff}
	}

	switch b.InputType {
	case "checkbox", "radio":
		s := min(r.Dx(), r.Dy())
		box := image.Rect(r.Min.X, r.Min.Y, r.Min.X+s, r.Min.Y+s)
		if b.InputType == "radio" {
			circle(img, box, gray, b.Checked, fg)
			return
		}
		outline(img, box, gray)
		if b.Checked {
			fill(img, box.Inset(3), fg)
		}
		return
	}

	// Native fields often have no CSS border: give them a light frame.
	if len(b.Border) == 4 && b.Border[0].W == 0 {
		outline(img, r, gray)
	}

	text, c := b.Value, fg
	if text == "" {
		text, c = b.Placeholder, gray
	}
	if text == "" {
		return
	}

	clip := img.SubImage(r.Inset(1)).(*image.RGBA)
	face := fonts.face(b.Bold, b.Italic, b.FontSize)
	m := face.Metrics()
	tw := font.MeasureString(face, text).Round()
	x := r.Min.X + 4
	if b.InputType == "submit" || b.InputType == "button" || b.InputType == "reset" {
		x = r.Min.X + max((r.Dx()-tw)/2, 2)
	}
	y := r.Min.Y + (r.Dy()+m.Ascent.Round()-m.Descent.Round())/2
	if b.InputType == "textarea" {
		y = r.Min.Y + 4 + m.Ascent.Round()
	}
	d := font.Drawer{Dst: clip, Src: image.NewUniform(c), Face: face, Dot: fixed.P(x, y)}
	d.DrawString(text)

	if b.InputType == "select" {
		drawSmall(clip, r.Max.X-12, r.Min.Y+r.Dy()/2+4, "v", gray)
	}
}

// drawLabel writes a small tag#id in the top-left corner of the box.
func drawLabel(img *image.RGBA, r image.Rectangle, b Box) {
	label := b.Tag
	if b.ID != "" {
		label += "#" + b.ID
	}
	if r.Dx() < 7*len(label)+4 || r.Dy() < 16 {
		return
	}
	c := palette[b.Depth%len(palette)]
	c.A = 0xa0
	drawSmall(img, r.Min.X+2, r.Min.Y+11, label, c)
}

// drawSmall writes text with the 7x13 bitmap font.
func drawSmall(img *image.RGBA, x, y int, s string, c color.NRGBA) {
	d := font.Drawer{Dst: img, Src: image.NewUniform(c), Face: basicfont.Face7x13, Dot: fixed.P(x, y)}
	d.DrawString(s)
}

func line(img *image.RGBA, x0, y0, x1, y1 int, c color.NRGBA) {
	steps := max(abs(x1-x0), abs(y1-y0), 1)
	for i := 0; i <= steps; i++ {
		x := x0 + (x1-x0)*i/steps
		y := y0 + (y1-y0)*i/steps
		fill(img, image.Rect(x, y, x+1, y+1), c)
	}
}

// circle draws a ring inside r, with a dot in the middle when filled is set.
func circle(img *image.RGBA, r image.Rectangle, ring color.NRGBA, filled bool, dot color.NRGBA) {
	cx := float64(r.Min.X+r.Max.X) / 2
	cy := float64(r.Min.Y+r.Max.Y) / 2
	rad := float64(r.Dx()) / 2
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			d := math.Hypot(float64(x)+0.5-cx, float64(y)+0.5-cy)
			switch {
			case d <= rad && d > rad-1.2:
				fill(img, image.Rect(x, y, x+1, y+1), ring)
			case filled && d <= rad-3:
				fill(img, image.Rect(x, y, x+1, y+1), dot)
			}
		}
	}
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// parseColor reads the computed CSS colors returned by the browser:
// rgb(r, g, b), rgba(r, g, b, a), rgb(r g b / a) and transparent.
// Other forms (oklch, color-mix...) return false.
func parseColor(s string) (color.NRGBA, bool) {
	s = strings.TrimSpace(s)
	if s == "transparent" {
		return color.NRGBA{}, true
	}
	var body string
	switch {
	case strings.HasPrefix(s, "rgba(") && strings.HasSuffix(s, ")"):
		body = s[5 : len(s)-1]
	case strings.HasPrefix(s, "rgb(") && strings.HasSuffix(s, ")"):
		body = s[4 : len(s)-1]
	default:
		return color.NRGBA{}, false
	}
	parts := strings.Fields(strings.NewReplacer(",", " ", "/", " ").Replace(body))
	if len(parts) != 3 && len(parts) != 4 {
		return color.NRGBA{}, false
	}
	var v [4]float64
	v[3] = 1
	for i, p := range parts {
		pct := strings.HasSuffix(p, "%")
		f, err := strconv.ParseFloat(strings.TrimSuffix(p, "%"), 64)
		if err != nil {
			return color.NRGBA{}, false
		}
		if pct {
			f /= 100
			if i < 3 {
				f *= 255
			}
		}
		v[i] = f
	}
	clamp := func(f float64) uint8 { return uint8(math.Round(min(max(f, 0), 255))) }
	return color.NRGBA{clamp(v[0]), clamp(v[1]), clamp(v[2]), clamp(v[3] * 255)}, true
}

// fonts holds the Go font family and caches one face per style and size.
type fonts struct {
	regular, bold, italic, boldItalic *opentype.Font
	faces                             map[fontKey]font.Face
}

type fontKey struct {
	bold, italic bool
	size         float64
}

func newFonts() (*fonts, error) {
	f := &fonts{faces: map[fontKey]font.Face{}}
	for _, x := range []struct {
		dst  **opentype.Font
		data []byte
	}{
		{&f.regular, goregular.TTF},
		{&f.bold, gobold.TTF},
		{&f.italic, goitalic.TTF},
		{&f.boldItalic, gobolditalic.TTF},
	} {
		parsed, err := opentype.Parse(x.data)
		if err != nil {
			return nil, fmt.Errorf("parse font: %w", err)
		}
		*x.dst = parsed
	}
	return f, nil
}

// face returns a face for a size in CSS pixels, rounded to half a pixel.
func (f *fonts) face(bold, italic bool, px float64) font.Face {
	px = max(math.Round(px*2)/2, 4)
	k := fontKey{bold, italic, px}
	if face, ok := f.faces[k]; ok {
		return face
	}
	src := f.regular
	switch {
	case bold && italic:
		src = f.boldItalic
	case bold:
		src = f.bold
	case italic:
		src = f.italic
	}
	// At 72 DPI, one point is one pixel.
	face, err := opentype.NewFace(src, &opentype.FaceOptions{Size: px, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		face = basicfont.Face7x13
	}
	f.faces[k] = face
	return face
}

// env returns the env value corresponding to the key or the default string.
func env(key, dflt string) string {
	val, ok := os.LookupEnv(key)
	if !ok {
		return dflt
	}

	return val
}
