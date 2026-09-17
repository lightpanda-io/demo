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

	"github.com/chromedp/chromedp"
	"github.com/chromedp/chromedp/kb"
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
	CdpWSDefault = "ws://127.0.0.1:9222/"
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
		fmt.Fprintf(stderr, "chromedp fetch url, type into the #input and #ta fields and press Enter on form controls.\n")
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
	url := "http://127.0.0.1:1234/form/get.html"
	if len(args) > 0 {
		url = args[0]
	}

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

	// SendKeys sends keyDown (no text), char (with text) and keyUp for each
	// printable character; '\n' is sent as an Enter key with a "\r" char.
	var inputValue, taValue string
	err := chromedp.Run(ctx,
		chromedp.Navigate(url),
		chromedp.Evaluate(`document.getElementById("input").value = ""`, nil),
		chromedp.SendKeys("#input", "hello World!", chromedp.ByQuery),
		chromedp.Value("#input", &inputValue, chromedp.ByQuery),
		chromedp.SendKeys("#ta", "one\ntwo", chromedp.ByQuery),
		chromedp.Value("#ta", &taValue, chromedp.ByQuery),
	)
	if err != nil {
		return fmt.Errorf("send keys: %w", err)
	}

	if inputValue != "hello World!" {
		return fmt.Errorf("incorrect #input value: %q", inputValue)
	}
	if taValue != "one\ntwo" {
		return fmt.Errorf("incorrect #ta value: %q", taValue)
	}

	// A canceled beforeinput blocks the insertion, but keypress, which is
	// dispatched before it, still fires for every key.
	var keypresses string
	err = chromedp.Run(ctx,
		chromedp.Evaluate(`
			const input = document.getElementById("input");
			input.value = "";
			window.keypresses = [];
			input.addEventListener("keypress", (e) => window.keypresses.push(e.key));
			input.addEventListener("beforeinput", (e) => {
				if (/[0-9]/.test(e.data)) e.preventDefault();
			});
		`, nil),
		chromedp.SendKeys("#input", "a1b2", chromedp.ByQuery),
		chromedp.Value("#input", &inputValue, chromedp.ByQuery),
		chromedp.Evaluate(`window.keypresses.join("")`, &keypresses),
	)
	if err != nil {
		return fmt.Errorf("send keys with canceled beforeinput: %w", err)
	}

	if inputValue != "ab" {
		return fmt.Errorf("incorrect #input value with canceled beforeinput: %q", inputValue)
	}
	if keypresses != "a1b2" {
		return fmt.Errorf("incorrect keypress events with canceled beforeinput: %q", keypresses)
	}

	// Enter activates a button after its keypress, and submits the form at
	// most once. Only the focused control's keypress and click are recorded.
	enterCases := []struct {
		id     string
		expect string
	}{
		{id: "input", expect: "keypress submit"},
		{id: "check", expect: "keypress submit"},
		{id: "submit", expect: "keypress click submit"},
		{id: "button", expect: "keypress click submit"},
		{id: "ibutton", expect: "keypress click"},
		{id: "reset", expect: "keypress click"},
	}
	var enterErrs []error
	for _, c := range enterCases {
		var events string
		err = chromedp.Run(ctx,
			chromedp.Navigate(url),
			chromedp.Evaluate(fmt.Sprintf(`{
				const form = document.getElementById("f");
				form.insertAdjacentHTML("beforeend",
					'<input id=check type=checkbox><button id=button>go</button>' +
					'<input id=ibutton type=button value=b><input id=reset type=reset>');
				window.events = [];
				form.addEventListener("submit", (e) => {
					e.preventDefault();
					window.events.push("submit");
				});
				const el = document.getElementById(%q);
				el.addEventListener("keypress", () => window.events.push("keypress"));
				el.addEventListener("click", () => window.events.push("click"));
			}`, c.id), nil),
			chromedp.SendKeys("#"+c.id, kb.Enter, chromedp.ByQuery),
			chromedp.Evaluate(`window.events.join(" ")`, &events),
		)
		if err != nil {
			return fmt.Errorf("enter on #%s: %w", c.id, err)
		}
		if events != c.expect {
			enterErrs = append(enterErrs, fmt.Errorf("incorrect events for enter on #%s: %q, expected %q", c.id, events, c.expect))
		}
	}

	return errors.Join(enterErrs...)
}

// env returns the env value corresponding to the key or the default string.
func env(key, dflt string) string {
	val, ok := os.LookupEnv(key)
	if !ok {
		return dflt
	}

	return val
}
