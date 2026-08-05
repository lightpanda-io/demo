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

// chromedp variant of playwright/cdp_session_redirect.js, driving Fetch
// interception through the driver's own (primary) target session. Navigates
// through /redirect/headers -> /get/headers (302) and asserts that both hops
// are paused with fresh requestIds and a stable networkId, and that a header
// override applied to the initial request does not survive the redirect.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/url"
	"os"
	"strings"
	"sync"

	"github.com/chromedp/cdproto/fetch"
	"github.com/chromedp/chromedp"
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

type pause struct {
	requestID string
	networkID string
	url       string
	headers   map[string]string
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
		fmt.Fprintf(stderr, "chromedp request interception through a redirect.\n")
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
	initialURL := baseURL + "/redirect/headers"
	destinationPrefix := baseURL + "/get/headers"

	ctx, cancel := chromedp.NewRemoteAllocator(ctx,
		*cdpws, chromedp.NoModifyURL,
	)
	defer cancel()

	// build context options
	var opts []chromedp.ContextOption
	if *verbose {
		opts = append(opts, chromedp.WithDebugf(log.Printf))
	}

	ctx, cancel = chromedp.NewContext(ctx, opts...)
	defer cancel()

	// ensure the first tab is created
	if err := chromedp.Run(ctx); err != nil {
		return fmt.Errorf("new tab: %w", err)
	}

	var mu sync.Mutex
	var pauses []pause

	chromedp.ListenTarget(ctx, func(ev any) {
		switch ev := ev.(type) {
		case *fetch.EventRequestPaused:
			evURL := ev.Request.URL
			relevant := evURL == initialURL || strings.HasPrefix(evURL, destinationPrefix)
			if relevant {
				headers := make(map[string]string, len(ev.Request.Headers))
				for name, value := range ev.Request.Headers {
					headers[name] = fmt.Sprint(value)
				}
				mu.Lock()
				pauses = append(pauses, pause{
					requestID: string(ev.RequestID),
					networkID: string(ev.NetworkID),
					url:       evURL,
					headers:   headers,
				})
				mu.Unlock()
			}

			go func() {
				req := fetch.ContinueRequest(ev.RequestID)
				if evURL == initialURL {
					entries := []*fetch.HeaderEntry{{Name: "x-lightpanda-probe", Value: "initial"}}
					for name, value := range ev.Request.Headers {
						entries = append(entries, &fetch.HeaderEntry{Name: name, Value: fmt.Sprint(value)})
					}
					req = req.WithHeaders(entries)
				}
				if err := chromedp.Run(ctx, req); err != nil {
					fmt.Fprintf(os.Stderr, "continueRequest %s: %v\n", ev.RequestID, err)
				}
			}()
		}
	})

	if err := chromedp.Run(ctx,
		fetch.Enable().WithPatterns(nil),
	); err != nil {
		return fmt.Errorf("fetch enable: %w", err)
	}

	if err := chromedp.Run(ctx, chromedp.Navigate(initialURL)); err != nil {
		return fmt.Errorf("navigate %s: %w", initialURL, err)
	}

	var search, preText string
	if err := chromedp.Run(ctx,
		chromedp.Evaluate(`location.search`, &search),
		chromedp.Evaluate(`document.querySelector('pre').textContent`, &preText),
	); err != nil {
		return fmt.Errorf("read destination page: %w", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if len(pauses) != 2 {
		return fmt.Errorf("expected 2 paused requests, got %d: %+v", len(pauses), pauses)
	}
	if pauses[0].url != initialURL {
		return fmt.Errorf("first pause is not the initial request: %s", pauses[0].url)
	}
	if !strings.HasPrefix(pauses[1].url, destinationPrefix) {
		return fmt.Errorf("second pause is not the redirect target: %s", pauses[1].url)
	}
	if pauses[0].requestID == pauses[1].requestID {
		return fmt.Errorf("redirect pause must get a fresh requestId, got %s twice", pauses[0].requestID)
	}
	if pauses[0].networkID != pauses[1].networkID {
		return fmt.Errorf("networkId must be stable across the redirect: %s != %s", pauses[0].networkID, pauses[1].networkID)
	}
	for name := range pauses[1].headers {
		if strings.EqualFold(name, "x-lightpanda-probe") {
			return errors.New("header override leaked into the redirected request (pause view)")
		}
	}

	// The redirect endpoint echoes the received probe header into the
	// Location query string: the override reached the first hop.
	query, err := url.ParseQuery(strings.TrimPrefix(search, "?"))
	if err != nil {
		return fmt.Errorf("parse landing query %q: %w", search, err)
	}
	if query.Get("probe") != "initial" {
		return fmt.Errorf("header override did not reach the initial request: %q", search)
	}

	// /get/headers serves the headers of the request it received as JSON.
	var served map[string][]string
	if err := json.Unmarshal([]byte(preText), &served); err != nil {
		return fmt.Errorf("parse served headers %q: %w", preText, err)
	}
	for name := range served {
		if strings.EqualFold(name, "x-lightpanda-probe") {
			return errors.New("header override leaked into the redirected request (server view)")
		}
	}

	fmt.Fprintf(stdout, "pauses: %s -> %s (networkId %s)\n", pauses[0].requestID, pauses[1].requestID, pauses[0].networkID)

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
