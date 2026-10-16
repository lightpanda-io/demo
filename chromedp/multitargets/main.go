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

// Several tabs (CDP targets) in one browser, over one connection. Each tab
// loads a different amiibo; the tabs run at the same time.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"strings"
	"sync"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"
	"golang.org/x/sync/errgroup"
)

const (
	exitOK   = 0
	exitFail = 1
)

// main starts interruptable context and runs the program.
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

const (
	CdpWSDefault = "ws://127.0.0.1:9222"
)

// amiibo page => character name it displays once its JSON is loaded.
var amiibos = []struct{ id, name string }{
	{"00000002", "Mario"},
	{"00010002", "Peach"},
	{"00020002", "Yoshi"},
	{"00030002", "Donkey Kong"},
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose = flags.Bool("verbose", false, "enable debug log level")
		cdpws   = flags.String("cdp", env("CDPCLI_WS", CdpWSDefault), "cdp ws to connect")
	)

	// usage func declaration.
	exec := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s <base url>\n", exec)
		fmt.Fprintf(stderr, "chromedp loads several amiibo pages at the same time, one tab each.\n")
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
		return errors.New("base url is required")
	}
	baseURL := strings.TrimSuffix(args[0], "/")

	ctx, cancel := chromedp.NewRemoteAllocator(ctx,
		*cdpws, chromedp.NoModifyURL,
	)
	defer cancel()

	// build context options
	var opts []chromedp.ContextOption
	if *verbose {
		opts = append(opts, chromedp.WithDebugf(log.Printf))
	}

	// The first tab. Canceling it closes the connection.
	browserCtx, cancel := chromedp.NewContext(ctx, opts...)
	defer cancel()
	if err := chromedp.Run(browserCtx); err != nil {
		return fmt.Errorf("new tab: %w", err)
	}

	// One more tab per amiibo, created from the first one: same browser,
	// same connection.
	tabs := make([]context.Context, len(amiibos))
	closeTab := make([]context.CancelFunc, len(amiibos))
	for i := range amiibos {
		tabs[i], closeTab[i] = chromedp.NewContext(browserCtx)
		defer closeTab[i]()
	}

	// Each tab only sees the requests of its own document.
	var mu sync.Mutex
	requests := make([][]string, len(amiibos))
	for i := range tabs {
		chromedp.ListenTarget(tabs[i], func(ev any) {
			if e, ok := ev.(*network.EventRequestWillBeSent); ok {
				mu.Lock()
				requests[i] = append(requests[i], e.Request.URL)
				mu.Unlock()
			}
		})
	}

	names := make([]string, len(amiibos))
	g, _ := errgroup.WithContext(ctx)
	for i, a := range amiibos {
		g.Go(func() error {
			err := chromedp.Run(tabs[i],
				network.Enable(),
				chromedp.Navigate(baseURL+"/amiibo/"+a.id+".html"),
				// The name is set by the page's script once its JSON is fetched.
				chromedp.Poll(`document.getElementById('name').textContent !== 'Amiibo Character'`, nil),
				chromedp.Text("#name", &names[i], chromedp.ByQuery),
			)
			if err != nil {
				return fmt.Errorf("tab %d: %w", i, err)
			}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return err
	}

	for i, a := range amiibos {
		fmt.Fprintf(stdout, "tab %d: %s\n", i, names[i])
		if names[i] != a.name {
			return fmt.Errorf("tab %d: expected %s, got %s", i, a.name, names[i])
		}
		json := "/amiibo/" + a.id + ".json"
		mine := false
		for _, url := range requests[i] {
			if strings.HasSuffix(url, ".json") && !strings.HasSuffix(url, json) {
				return fmt.Errorf("tab %d: got another tab's request %s", i, url)
			}
			mine = mine || strings.HasSuffix(url, json)
		}
		if !mine {
			return fmt.Errorf("tab %d: missing its JSON request", i)
		}
	}

	// Closing a tab leaves the others running.
	closeTab[0]()
	for i := 1; i < len(tabs); i++ {
		var title string
		if err := chromedp.Run(tabs[i], chromedp.Title(&title)); err != nil {
			return fmt.Errorf("tab %d after closing tab 0: %w", i, err)
		}
		if title != amiibos[i].name {
			return fmt.Errorf("tab %d changed when tab 0 closed: %s", i, title)
		}
	}
	fmt.Fprintln(stdout, "tab 0 closed, the others still work")

	return nil
}

// env returns the env value corresponding to the key or the default string.
func env(key, dflt string) string {
	val, ok := os.LookupEnv(key)
	if !ok {
		return dflt
	}

	return val
}
