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
	"log"
	"log/slog"
	"os"
	"time"

	"github.com/chromedp/cdproto/page"
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
		fmt.Fprintf(stderr, "chromedp fetch url and click on `campfire-commerce`.\n")
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

	// Navigate and click on the link
	err := chromedp.Run(ctx,
		chromedp.Navigate(url),
		chromedp.Click("a[href='campfire-commerce/']", chromedp.ByQuery),
	)
	if err != nil {
		return fmt.Errorf("click: %w", err)
	}

	// chromedp.WaitNewTarget is a higher level abstraction for this, but we
	// need to start emiting Target events, specifically:
	// https://chromedevtools.github.io/devtools-protocol/tot/Target/#event-targetCreated
	// https://chromedevtools.github.io/devtools-protocol/tot/Target/#event-targetInfoChanged
	clickComplete := make(chan struct{})
	chromedp.ListenTarget(ctx, func(ev any) {
		if _, ok := ev.(*page.EventDomContentEventFired); ok {
			clickComplete <- struct{}{}
		}
	})

	select {
	case <-clickComplete:
	case <-time.After(time.Second * 5):
		return errors.New("click timeout")
	}

	// Validation
	var currentURL string
	var priceText string
	var reviewNames []string
	var reviewTexts []string
	err = chromedp.Run(ctx,
		chromedp.Location(&currentURL),
		chromedp.Text("#product-price", &priceText, chromedp.NodeVisible, chromedp.ByQuery),
		chromedp.Evaluate(`Array.from(document.querySelectorAll('#product-reviews > div h4')).map(e => e.textContent)`, &reviewNames),
		chromedp.Evaluate(`Array.from(document.querySelectorAll('#product-reviews > div p')).map(e => e.textContent)`, &reviewTexts),
	)
	if err != nil {
		return fmt.Errorf("checks failed: %w", err)
	}
	if currentURL != "http://127.0.0.1:1234/campfire-commerce/" {
		return errors.New("the new page URL is not as expected")
	}
	if priceText != "$244.99" {
		return fmt.Errorf("incorrect product price: %s", priceText)
	}
	if len(reviewNames) != 3 || len(reviewTexts) != 3 {
		return errors.New("incorrect reviews count")
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
