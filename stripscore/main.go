// stripscore scores `lightpanda fetch --dump markdown --strip-mode ...`
// against mozilla/readability's test corpus. A measuring instrument, not a
// test: it reports how a strip mode moves recall and junk across the corpus.
// See README.md.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	if err := run(ctx, os.Args, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

type listFlag []string

func (l *listFlag) String() string     { return strings.Join(*l, ",") }
func (l *listFlag) Set(v string) error { *l = append(*l, v); return nil }

type page struct {
	Name       string `json:"name"`
	Prefix     string `json:"prefix"`
	Readerable bool   `json:"readerable"`
	dir        string
}

type score struct {
	Error         string  `json:"error,omitempty"`
	Recall        float64 `json:"recall"`
	Junk          float64 `json:"junk"`
	ExpectedWords int     `json:"expected_words"`
	Words         int     `json:"words"`
	Undone        bool    `json:"undone"`
	Fallback      bool    `json:"fallback"`
}

type result struct {
	page
	Modes map[string]*score `json:"modes"`
}

func run(ctx context.Context, args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet(args[0], flag.ExitOnError)
	bin := fs.String("bin", "../../browser/zig-out/bin/lightpanda", "lightpanda binary")
	corpus := fs.String("corpus", "../../readability/test/test-pages", "mozilla/readability test/test-pages checkout")
	negatives := fs.String("negatives", "negatives", "hand-built pages; each <name>/{source,expected}.html")
	var modes listFlag
	fs.Var(&modes, "strip", "--strip-mode value to score; 'none' for a raw dump. Repeatable. Default: none, clutter")
	filter := fs.String("filter", "", "only pages whose name contains this")
	runJS := fs.Bool("run-js", false, "keep <script> in served source.html")
	jobs := fs.Int("jobs", 4, "concurrent fetches")
	show := fs.Int("show", 10, "worst pages to list per mode")
	out := fs.String("out", "", "write per-page results as JSON")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if len(modes) == 0 {
		modes = listFlag{"none", "clutter"}
	}
	if _, err := os.Stat(*bin); err != nil {
		return fmt.Errorf("no binary at %s; pass -bin", *bin)
	}

	pages := append(pagesIn(*corpus, "c"), pagesIn(*negatives, "n")...)
	if *filter != "" {
		var kept []page
		for _, p := range pages {
			if strings.Contains(p.Name, *filter) {
				kept = append(kept, p)
			}
		}
		pages = kept
	}
	if len(pages) == 0 {
		return fmt.Errorf("no pages found; pass -corpus <readability>/test/test-pages")
	}

	srv, base, err := serve(map[string]string{"c": *corpus, "n": *negatives}, !*runJS)
	if err != nil {
		return err
	}
	defer srv.Close()

	// One job per (page, mode) plus one per page for expected.html; all
	// independent, so they share one pool.
	type job struct {
		page int
		mode string // "" = expected.html
	}
	var jobsList []job
	for i := range pages {
		jobsList = append(jobsList, job{i, ""})
		for _, m := range modes {
			jobsList = append(jobsList, job{i, m})
		}
	}
	fetched := make([]fetchResult, len(jobsList))
	var wg sync.WaitGroup
	sem := make(chan struct{}, max(*jobs, 1))
	for i, j := range jobsList {
		wg.Add(1)
		go func(i int, j job) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			p := pages[j.page]
			file, mode := "source.html", j.mode
			if mode == "" {
				file, mode = "expected.html", "none"
			}
			url := fmt.Sprintf("%s/%s/%s/%s", base, p.Prefix, p.Name, file)
			fetched[i] = fetch(ctx, *bin, url, mode)
		}(i, j)
	}
	wg.Wait()

	results := make([]result, len(pages))
	k := 0
	for i, p := range pages {
		results[i] = result{page: p, Modes: map[string]*score{}}
		exp := fetched[k]
		k++
		for _, m := range modes {
			o := fetched[k]
			k++
			s := &score{Undone: o.undone, Fallback: o.fallback}
			switch {
			case exp.err != "":
				s.Error = exp.err
			case o.err != "":
				s.Error = o.err
			default:
				s.Recall, s.Junk, s.ExpectedWords, s.Words = compare(exp.md, o.md)
			}
			results[i].Modes[m] = s
		}
	}

	for _, group := range []struct{ prefix, label string }{{"c", "corpus"}, {"n", "negatives"}} {
		var rows []result
		for _, r := range results {
			if r.Prefix == group.prefix {
				rows = append(rows, r)
			}
		}
		if len(rows) == 0 {
			continue
		}
		fmt.Fprintf(stdout, "\n== %s: %d pages\n", group.label, len(rows))
		fmt.Fprintf(stdout, "%-16s%6s%7s%7s%7s%9s%9s%11s%10s\n", "mode", "pages", "errors", "undone", "fallbk", "recall", "junk", "recall<90%", "junk>25%")
		for _, m := range modes {
			var ok []*score
			var errors, undone, fallback int
			for _, r := range rows {
				s := r.Modes[m]
				if s.Undone {
					undone++
				}
				if s.Fallback {
					fallback++
				}
				if s.Error != "" {
					errors++
					continue
				}
				ok = append(ok, s)
			}
			if len(ok) == 0 {
				fmt.Fprintf(stdout, "%-16s%6d%7d%7d%7d\n", m, len(rows), errors, undone, fallback)
				continue
			}
			var recall, junk float64
			var low, noisy int
			for _, s := range ok {
				recall += s.Recall
				junk += s.Junk
				if s.Recall < 0.9 {
					low++
				}
				if s.Junk > 0.25 {
					noisy++
				}
			}
			n := float64(len(ok))
			fmt.Fprintf(stdout, "%-16s%6d%7d%7d%7d%8.1f%%%8.1f%%%11d%10d\n", m, len(rows), errors, undone, fallback, 100*recall/n, 100*junk/n, low, noisy)
		}
		if *show > 0 {
			for _, m := range modes {
				byRecall := append([]result(nil), rows...)
				sort.SliceStable(byRecall, func(a, b int) bool {
					sa, sb := byRecall[a].Modes[m], byRecall[b].Modes[m]
					ra, rb := sa.Recall, sb.Recall
					if sa.Error != "" {
						ra = -1
					}
					if sb.Error != "" {
						rb = -1
					}
					if ra != rb {
						return ra < rb
					}
					return sa.Junk > sb.Junk
				})
				var byJunk []result
				for _, r := range rows {
					if r.Modes[m].Error == "" {
						byJunk = append(byJunk, r)
					}
				}
				sort.SliceStable(byJunk, func(a, b int) bool { return byJunk[a].Modes[m].Junk > byJunk[b].Modes[m].Junk })
				printRows(stdout, fmt.Sprintf("%s / %s: worst %d by recall", group.label, m, *show), byRecall[:min(*show, len(byRecall))], m)
				printRows(stdout, fmt.Sprintf("%s / %s: most junk left", group.label, m), byJunk[:min(*show, len(byJunk))], m)
			}
		}
	}

	if *out != "" {
		f, err := os.Create(*out)
		if err != nil {
			return err
		}
		defer f.Close()
		enc := json.NewEncoder(f)
		enc.SetIndent("", " ")
		if err := enc.Encode(results); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "\nwrote %s\n", *out)
	}
	return nil
}

func printRows(w io.Writer, title string, rows []result, mode string) {
	fmt.Fprintf(w, "\n-- %s\n", title)
	for _, r := range rows {
		s := r.Modes[mode]
		flag := ""
		if !r.Readerable {
			flag = " (not readerable)"
		}
		if s.Error != "" {
			fmt.Fprintf(w, "  %-44s ERROR %s%s\n", r.Name, s.Error, flag)
			continue
		}
		extra := ""
		if s.Undone {
			extra += " undone"
		}
		if s.Fallback {
			extra += " fallback"
		}
		fmt.Fprintf(w, "  %-44s recall %5.1f%%  junk %5.1f%%  words %d/%d%s%s\n", r.Name, 100*s.Recall, 100*s.Junk, s.Words, s.ExpectedWords, extra, flag)
	}
}

func pagesIn(root, prefix string) []page {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var pages []page
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(root, e.Name())
		if !exists(filepath.Join(dir, "source.html")) || !exists(filepath.Join(dir, "expected.html")) {
			continue
		}
		p := page{Name: e.Name(), Prefix: prefix, Readerable: true, dir: dir}
		if meta, err := os.ReadFile(filepath.Join(dir, "expected-metadata.json")); err == nil {
			var m struct {
				Readerable *bool `json:"readerable"`
			}
			if json.Unmarshal(meta, &m) == nil && m.Readerable != nil {
				p.Readerable = *m.Readerable
			}
		}
		pages = append(pages, p)
	}
	return pages
}

func exists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

// --- serving -----------------------------------------------------------------

// Scripts are the only subresource fetched by default; preload links are the
// other way a page reaches the network. Both go so the corpus stays offline
// and matches readability's script-free DOM.
var (
	scriptRE  = regexp.MustCompile(`(?is)<script\b.*?</script\s*>`)
	preloadRE = regexp.MustCompile(`(?i)<link\b[^>]*\brel\s*=\s*["']?(?:module)?preload[^>]*>`)
)

func serve(roots map[string]string, stripScripts bool) (*http.Server, string, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, "", err
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/"), "/", 2)
		root, ok := roots[parts[0]]
		if !ok || len(parts) < 2 || strings.Contains(parts[1], "..") {
			http.NotFound(w, r)
			return
		}
		body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(parts[1])))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if stripScripts && strings.HasSuffix(parts[1], "source.html") {
			body = preloadRE.ReplaceAll(scriptRE.ReplaceAll(body, nil), nil)
		}
		if strings.HasSuffix(parts[1], ".html") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		}
		w.Write(body)
	})
	srv := &http.Server{Handler: handler}
	go srv.Serve(ln)
	return srv, "http://" + ln.Addr().String(), nil
}

// --- fetching ----------------------------------------------------------------

type fetchResult struct {
	md       string
	err      string
	undone   bool
	fallback bool
}

const (
	undoneMarker   = "strip shell undone"
	fallbackMarker = "strip clutter fallback"
)

func fetch(ctx context.Context, bin, url, mode string) fetchResult {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	args := []string{"fetch", "--log-format", "logfmt", "--dump", "markdown", "--terminate-ms", "5000"}
	if mode != "none" {
		args = append(args, "--strip-mode", mode)
	}
	args = append(args, url)
	cmd := exec.CommandContext(ctx, bin, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	log := stderr.String()
	r := fetchResult{
		md:       stdout.String(),
		undone:   strings.Contains(log, undoneMarker),
		fallback: strings.Contains(log, fallbackMarker),
	}
	if err != nil {
		r.err = lastError(log)
	}
	return r
}

var errRE = regexp.MustCompile(`err=(\S+)`)

func lastError(log string) string {
	lines := strings.Split(strings.TrimSpace(log), "\n")
	last := ""
	for _, l := range lines {
		if strings.Contains(l, "$level=error") || strings.Contains(l, "$level=fatal") {
			last = l
		}
	}
	if last == "" && len(lines) > 0 {
		last = lines[len(lines)-1]
	}
	if last == "" {
		return "exit != 0"
	}
	if m := errRE.FindStringSubmatch(last); m != nil {
		return m[1]
	}
	if len(last) > 80 {
		last = last[len(last)-80:]
	}
	return last
}

// --- scoring -----------------------------------------------------------------

var (
	imgRE  = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	linkRE = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	urlRE  = regexp.MustCompile(`https?://\S+`)
	escRE  = regexp.MustCompile("\\\\([\\\\`*_{}\\[\\]()#+\\-.!<>|~])")
)

// words reduces markdown to lowercase word tokens: link and image URLs go,
// escapes unwrap, CJK splits per character.
func words(md string) []string {
	md = imgRE.ReplaceAllString(md, " ")
	md = linkRE.ReplaceAllString(md, "$1")
	md = urlRE.ReplaceAllString(md, " ")
	md = escRE.ReplaceAllString(md, "$1")
	md = strings.ReplaceAll(md, "```", " ")
	md = strings.ToLower(md)

	var out []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
	}
	for _, r := range md {
		switch {
		case isCJK(r):
			flush()
			out = append(out, string(r))
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_':
			cur.WriteRune(r)
		default:
			flush()
		}
	}
	flush()
	return out
}

func isCJK(r rune) bool {
	return (r >= 0x2E80 && r <= 0x9FFF) || (r >= 0xAC00 && r <= 0xD7AF) || (r >= 0xF900 && r <= 0xFAFF)
}

// compare aligns the two word lists: recall = expected words matched, junk =
// output words unmatched. Interleaved junk costs nothing on recall. The
// aligner pairs repeated paragraphs greedily, so an unaligned chunk that
// occurs verbatim on the other side still counts as matched.
func compare(expectedMD, outMD string) (recall, junk float64, expectedWords, outWords int) {
	ew, ow := words(expectedMD), words(outMD)
	eText, oText := " "+strings.Join(ew, " ")+" ", " "+strings.Join(ow, " ")+" "
	matchedE, matchedO := 0, 0
	i, j := 0, 0
	for _, b := range matchingBlocks(ew, ow) {
		if b.a > i && strings.Contains(oText, " "+strings.Join(ew[i:b.a], " ")+" ") {
			matchedE += b.a - i
		}
		if b.b > j && strings.Contains(eText, " "+strings.Join(ow[j:b.b], " ")+" ") {
			matchedO += b.b - j
		}
		matchedE += b.size
		matchedO += b.size
		i, j = b.a+b.size, b.b+b.size
	}
	recall, junk = 1, 0
	if len(ew) > 0 {
		recall = float64(matchedE) / float64(len(ew))
	}
	if len(ow) > 0 {
		junk = float64(len(ow)-matchedO) / float64(len(ow))
	}
	return recall, junk, len(ew), len(ow)
}

type block struct{ a, b, size int }

// matchingBlocks is difflib's get_matching_blocks without junk heuristics:
// the longest common block, recursively on both sides, ending in a sentinel
// block at (len(a), len(b), 0).
func matchingBlocks(a, b []string) []block {
	b2j := map[string][]int{}
	for j, w := range b {
		b2j[w] = append(b2j[w], j)
	}
	var blocks []block
	type span struct{ alo, ahi, blo, bhi int }
	queue := []span{{0, len(a), 0, len(b)}}
	for len(queue) > 0 {
		s := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		i, j, k := longestMatch(a, s.alo, s.ahi, s.blo, s.bhi, b2j)
		if k == 0 {
			continue
		}
		blocks = append(blocks, block{i, j, k})
		if s.alo < i && s.blo < j {
			queue = append(queue, span{s.alo, i, s.blo, j})
		}
		if i+k < s.ahi && j+k < s.bhi {
			queue = append(queue, span{i + k, s.ahi, j + k, s.bhi})
		}
	}
	sort.Slice(blocks, func(x, y int) bool { return blocks[x].a < blocks[y].a })
	return append(blocks, block{len(a), len(b), 0})
}

func longestMatch(a []string, alo, ahi, blo, bhi int, b2j map[string][]int) (besti, bestj, bestsize int) {
	besti, bestj = alo, blo
	j2len := map[int]int{}
	for i := alo; i < ahi; i++ {
		newj2len := map[int]int{}
		for _, j := range b2j[a[i]] {
			if j < blo {
				continue
			}
			if j >= bhi {
				break
			}
			k := j2len[j-1] + 1
			newj2len[j] = k
			if k > bestsize {
				besti, bestj, bestsize = i-k+1, j-k+1, k
			}
		}
		j2len = newj2len
	}
	return besti, bestj, bestsize
}
