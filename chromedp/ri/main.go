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
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
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
		fmt.Fprintf(stderr, "usage: %s <url>]\n", exec)
		fmt.Fprintf(stderr, "chromedp fetch an url and intercept requests.\n")
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
		return errors.New("url is required")
	}
	url := args[0]

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

	chromedp.ListenTarget(ctx, func(ev any) {
		switch ev := ev.(type) {
		case *fetch.EventRequestPaused:
			go func() {
				url := ev.Request.URL
				fmt.Fprintf(os.Stdout, "%s %s\n", ev.RequestID, url)

				// alter the response with a new body
				if strings.HasSuffix(url, "/reviews.json") {
					encoded := base64.StdEncoding.EncodeToString([]byte(`["alter review"]`))
					_ = chromedp.Run(ctx,
						fetch.FulfillRequest(ev.RequestID, 200).WithBody(encoded),
					)
					return
				}

				// by default let the request running.
				_ = chromedp.Run(ctx, fetch.ContinueRequest(ev.RequestID))
			}()
		}
	})

	if err := chromedp.Run(ctx,
		fetch.Enable().WithPatterns(nil),
	); err != nil {
		log.Fatal(err)
	}

	err := chromedp.Run(ctx, chromedp.Navigate(url))
	if err != nil {
		return fmt.Errorf("navigate %s: %w", url, err)
	}

	var a []*cdp.Node
	if err := chromedp.Run(ctx,
		chromedp.Nodes(`#product-reviews > div > p`, &a,
			chromedp.Populate(1, false,
				chromedp.PopulateWait(50*time.Millisecond),
			),
		),
	); err != nil {
		return fmt.Errorf("get reviews: %w", err)
	}

	reviews := make([]string, 0, len(a))
	for _, aa := range a {
		if len(aa.Children) != 1 {
			// should not happen, but it will be catched by the following
			// asserts.
			continue
		}
		reviews = append(reviews, aa.Children[0].NodeValue)
	}

	fmt.Fprintf(os.Stdout, "%v\n", reviews)

	if len(reviews) != 1 {
		return errors.New("invalid reviews number")
	}
	if reviews[0] != "alter review" {
		return errors.New("invalid reviews title")
	}

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
