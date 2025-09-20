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
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/url"
	"os"

	"github.com/chromedp/cdproto/cdp"
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
		fmt.Fprintf(stderr, "usage: %s <term>]\n", exec)
		fmt.Fprintf(stderr, "chromedp search a term on duckduckgo and extracts all first page results.\n")
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
		return errors.New("term is required")
	}
	u := fmt.Sprintf("https://duckduckgo.com/?q=%s", url.QueryEscape(args[0]))

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

	err := chromedp.Run(ctx, chromedp.Navigate(u))
	if err != nil {
		return fmt.Errorf("navigate %s: %w", u, err)
	}

	var nodes []*cdp.Node
	if err := chromedp.Run(ctx, chromedp.Nodes(`li[data-layout="organic"] article`, &nodes)); err != nil {
		return fmt.Errorf("get results: %w", err)
	}

	type item struct {
		Title    string
		Link     string
		Abstract string
	}

	items := make([]*item, 0, len(nodes))
	for _, n := range nodes {
		var i item
		err := chromedp.Run(ctx,
			chromedp.AttributeValue(`h2 a`, `href`, &i.Link, nil, chromedp.ByQuery, chromedp.FromNode(n)),
			chromedp.Text(`h2`, &i.Title, chromedp.ByQuery, chromedp.FromNode(n)),
			chromedp.Text(`[data-result="snippet"]`, &i.Abstract, chromedp.ByQuery, chromedp.FromNode(n)),
		)
		if err != nil {
			return fmt.Errorf("get item: %w", err)
		}

		items = append(items, &i)
	}

	enc := json.NewEncoder(stdout)
	if err := enc.Encode(items); err != nil {
		return fmt.Errorf("json encode: %w", err)
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
