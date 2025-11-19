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
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/cdp"
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
		fmt.Fprintf(stderr, "chromedp fetch url.\n")
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

	is_test := false
	if url == "test" {
		url = "http://127.0.0.1:1234/campfire-commerce/"
		is_test = true
	}

	b, cancel, err := NewBrowser(ctx, *cdpws)
	if err != nil {
		return err
	}
	defer cancel()

	page := b.MustConnect().MustPage()

	page.Navigate(url)
	page.MustWaitLoad()

	content := page.MustHTML()

	if is_test {
		expected := "<html><head>\n\t<title>Outdoor Odyssey Nomad Backpack</title>"
		if strings.HasPrefix(content, expected) == false {
			return fmt.Errorf("Invalid HTML: %s", content)
		}
	} else {
		fmt.Fprintln(stdout, content)
	}

	return nil

}

func NewBrowser(ctx context.Context, cdpws string) (*rod.Browser, func(), error) {
	// By default rod creates a browser w/ the Sec-WebSocket-Key: nil value.
	// This is not what is expected by github.com/gorilla/websocket
	// implementation which requires a base64 encoded value.
	// Here is the code to inject a valid Sec-WebSocket-Key.
	// https://github.com/go-rod/rod/issues/1092#issuecomment-3528476306

	// Generate a Sec-WebSocket-Key value.
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	key := base64.StdEncoding.EncodeToString(buf)

	// Create a websocket and connect to the server.
	ws := &cdp.WebSocket{}
	err := ws.Connect(ctx, cdpws, http.Header{
		"Sec-WebSocket-Key": {key},
	})
	if err != nil {
		return nil, nil, err
	}

	cli := cdp.New()
	cli.Start(ws)

	b := rod.New()
	b.Trace(true)
	b.Client(cli)

	return b, func() {
		b.Close()
		ws.Close()
	}, nil
}

// env returns the env value corresponding to the key or the default string.
func env(key, dflt string) string {
	val, ok := os.LookupEnv(key)
	if !ok {
		return dflt
	}

	return val
}
