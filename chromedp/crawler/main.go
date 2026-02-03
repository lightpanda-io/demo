// Copyright 2023-2025 Lightpanda (Selecy SAS)
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
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/chromedp"
)

const (
	exitOK   = 0
	exitFail = 1
)

// main starts interruptable context and runs the program.
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	err := run(ctx, os.Args, os.Stdout, os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(exitFail)
	}

	os.Exit(exitOK)
}

const (
	CdpWSDefault = "ws://127.0.0.1:9222"
)

func run(ctx context.Context, args []string, _, stderr io.Writer) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose  = flags.Bool("verbose", false, "enable debug log level")
		cdp      = flags.String("cdp", env("CDP_WS", CdpWSDefault), "cdp ws to connect, incompatible w/ fork")
		fork     = flags.Bool("fork", false, "Use fork to run lightpanda")
		lpd_path = flags.String("lpd-path", "", "path to lightpanda process, used with --fork only")
		poolsize = flags.Uint("pool", 10, "pool size")
		limit    = flags.Uint("limit", 0, "limit of url to crawl, 0 for no limit.")
	)

	// usage func declaration.
	exec := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s <url>]\n", exec)
		fmt.Fprintf(stderr, "crawler fetch url.\n")
		fmt.Fprintf(stderr, "\nCommand line options:\n")
		flags.PrintDefaults()
		fmt.Fprintf(stderr, "\nEnvironment vars:\n")
		fmt.Fprintf(stderr, "\tCDP_WS\tdefault %s\n", CdpWSDefault)
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	if *verbose {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}

	if *fork && *cdp != CdpWSDefault {
		return errors.New("fork option is not compatible with cdp")
	}

	if *fork && *lpd_path == "" {
		return errors.New("fork option requires --lpd-path")
	}

	var opts *BrowserOpt
	if *fork {
		opts = &BrowserOpt{
			port:    9222,
			path:    *lpd_path,
			verbose: *verbose,
		}
	}

	args = flags.Args()
	if len(args) != 1 {
		return errors.New("url is required")
	}
	u, err := url.ParseRequestURI(args[0])
	if err != nil {
		return fmt.Errorf("invalid url: %w", err)
	}

	is_test := false
	if args[0] == "http://127.0.0.1:1234/" && *limit > 0 {
		is_test = true
	}

	queue := make(chan *url.URL)
	result := make(chan *Page, *poolsize)

	crawler := Crawler{
		queue:  queue,
		result: result,
		known:  make(Known),
		limit:  int(*limit),
	}
	go func() {
		if err := crawler.Run(ctx, u); err != nil {
			slog.Error("crawler", slog.Any("err", err))
		}
		close(queue)
	}()

	fetch := Fetcher{queue: queue, result: result}
	if err := fetch.Run(ctx, *poolsize, *cdp, opts); err != nil {
		slog.Error("fetcher", slog.Any("err", err))
	}
	close(result)

	slog.Info("Crawler results", slog.Any("urls", len(crawler.known)))

	if is_test && int(*limit) != len(crawler.known) {
		return fmt.Errorf("Unexpected URL crawled: expected %d but %d", *limit, len(crawler.known))
	}

	return nil
}

type Fetcher struct {
	queue  <-chan *url.URL
	result chan<- *Page
}

func (f Fetcher) Run(ctx context.Context, size uint, cdp string, opts *BrowserOpt) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// No BrowserOpt, use one connection to existing browser.
	if opts == nil {
		ctx, cancel = chromedp.NewRemoteAllocator(ctx,
			cdp, chromedp.NoModifyURL,
		)
		defer cancel()
	}

	gfetch, ctx := errgroup.WithContext(ctx)
	gfork, ctx := errgroup.WithContext(ctx)

	// start the pool
	for i := range size {
		var lopts BrowserOpt
		fork := opts != nil

		// With BrowserOpt, start a new browser
		if fork {
			lopts = *opts
			lopts.port += int(i)
			gfork.Go(func() error {
				return BrowserRun(ctx, lopts)
			})
		}

		gfetch.Go(func() error {
			ctx := ctx
			cancel := cancel

			// With BrowserOpt, connect to the new browser.
			if fork {
				// wait readyness
				time.Sleep(100 * time.Millisecond)
				ctx, cancel = chromedp.NewRemoteAllocator(ctx,
					lopts.ws(), chromedp.NoModifyURL,
				)
				defer cancel()
			}

			ctx, cancel = chromedp.NewContext(ctx)
			defer cancel()

			for {
				select {
				case <-ctx.Done():
					return nil
				case u, ok := <-f.queue:
					if !ok {
						return nil
					}
					page, err := fetch(ctx, u)
					if err != nil {
						return fmt.Errorf("fetcher %d %s: %w", i, u, err)
					}
					f.result <- page
				}
			}
		})
	}
	if err := gfetch.Wait(); err != nil {
		return err
	}
	cancel()

	if err := gfork.Wait(); err != nil {
		return err
	}

	return nil
}

func fetch(ctx context.Context, u *url.URL) (*Page, error) {
	slog.Info("fetch", slog.Any("url", u))

	err := chromedp.Run(ctx, chromedp.Navigate(u.String()))
	if err != nil {
		return nil, fmt.Errorf("navigate %v: %w", u, err)
	}

	err = chromedp.Run(ctx, chromedp.WaitReady(`body`, chromedp.ByQuery))
	if err != nil {
		return nil, fmt.Errorf("navigate %v: %w", u, err)
	}

	var a []*cdp.Node
	if err := chromedp.Run(ctx, chromedp.Nodes(`a[href]`, &a)); err != nil {
		return nil, fmt.Errorf("get links: %w", err)
	}

	links := make([]*url.URL, 0, len(a))
	for _, aa := range a {
		v, ok := aa.Attribute("href")
		if !ok {
			continue
		}
		uu, err := url.Parse(v)
		if err != nil {
			slog.Error("ignored invalid URL", slog.String("url", v))
			continue
		}
		if !uu.IsAbs() {
			uu = u.ResolveReference(uu)
		}
		links = append(links, uu)
	}

	return &Page{URL: u, Links: links}, nil
}

type Page struct {
	URL   *url.URL
	Links []*url.URL
}

type State uint

const (
	Ready State = 0
	Queue State = 1
	Done  State = 2
)

type Known = map[string]*struct {
	u *url.URL
	s State // 0 ready, 1 enqued, 2
}

type Crawler struct {
	queue  chan<- *url.URL
	result <-chan *Page
	known  Known
	limit  int
}

func (c *Crawler) append(u *url.URL, s State) {
	c.known[u.String()] = &struct {
		u *url.URL
		s State
	}{
		u: u,
		s: s,
	}

}
func (c Crawler) end() bool {
	for _, v := range c.known {
		if v.s != Done {
			return false
		}
	}

	return true
}

func (c *Crawler) Run(ctx context.Context, seed *url.URL) error {
	c.queue <- seed
	c.append(seed, Queue)

	for {
		select {
		case <-ctx.Done():
			return nil
		case p, ok := <-c.result:
			if !ok {
				return nil
			}

			// mark url as done
			v, ok := c.known[p.URL.String()]
			if !ok {
				panic("unknown url") // not possible.
			}
			v.s = Done

			count := 0
			for _, u := range p.Links {
				// check the url to crawl limit.
				if c.limit > 0 && len(c.known) >= c.limit {
					break
				}

				count = 0
				// use only links with the same domain than seed.
				if seed.Host != u.Host {
					slog.Debug("ignore external url", slog.Any("url", u))
					continue
				}
				if _, ok := c.known[u.String()]; ok {
					slog.Debug("skip known url", slog.Any("url", u))
					continue
				}
				// mark url as known.
				c.append(u, Ready)
				count++
			}
			if count == 0 && c.end() {
				slog.Debug("no links added")
				return nil
			}
		}

		// non-blocking enqueue
		for _, v := range c.known {
			if v.s != Ready {
				continue
			}
			select {
			case c.queue <- v.u:
				v.s = Queue
			default:
				// keep url in the buffer
			}
		}
	}
}

// env returns the env value corresponding to the key or the default string.
func env(key, dflt string) string {
	val, ok := os.LookupEnv(key)
	if !ok {
		return dflt
	}

	return val
}

type BrowserOpt struct {
	verbose bool
	port    int
	path    string
}

func (b BrowserOpt) ws() string {
	return fmt.Sprintf("ws://127.0.0.1:%d", b.port)
}

func BrowserRun(ctx context.Context, opts BrowserOpt) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	cmd := exec.CommandContext(ctx, opts.path,
		"serve",
		"--port", strconv.Itoa(opts.port),
	)

	if opts.verbose {
		cmd.Stderr = os.Stderr
		cmd.Stdout = os.Stdout
	}

	slog.Debug("starting browser", slog.String("cmd", cmd.String()))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start command: %w", err)
	}

	// block until the end
	cmd.Wait()

	return nil
}
