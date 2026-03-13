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
	"os"
	"os/exec"
	"strings"
	"time"
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

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose = flags.Bool("verbose", false, "enable debug log level")
	)

	// usage func declaration.
	bin := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s\n", bin)
		fmt.Fprintf(stderr, "end to end tests\n")
		fmt.Fprintf(stderr, "\nCommand line options:\n")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	if *verbose {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}

	args = flags.Args()
	if len(args) != 0 {
		return errors.New("too many arguments")
	}

	// Run end to end tests.
	fails := 0
	for _, t := range []Test{
		{Bin: "node", Args: []string{"integration/duckduckgo.js"}},
		{Bin: "node", Args: []string{"integration/algolia.js"}},
		{Bin: "node", Args: []string{"integration/github.js"}},
		{Bin: "node", Args: []string{"integration/xange.js"}},
		{Bin: "node", Args: []string{"integration/readme_amiibo.js"}},
		{Bin: "node", Args: []string{"integration/quickstart_wikipedia.js"}},
		{Bin: "node", Args: []string{"integration/quickstart_hn.js"}},
		{Bin: "node", Args: []string{"integration/mastodon.js"}},
		{Bin: "node", Args: []string{"integration/old-reddit.js"}},
		{Bin: "node", Args: []string{"integration/reddit.js"}},
		{Bin: "node", Args: []string{"integration/google_news.js"}},
		{Bin: "node", Args: []string{"integration/google_news_redirection.js"}},
		{Bin: "node", Args: []string{"integration/bing.js"}},
		{Bin: "node", Args: []string{"integration/anthropic_docs.js"}},
	} {
		if *verbose {
			t.Stderr = stderr
			t.Stdout = stdout
			fmt.Fprintf(stdout, "=== \t%s\n", t)
		}

		start := time.Now()
		if err := runtest(ctx, t); err != nil {
			fmt.Fprintf(stdout, "=== ERR\t%s\n", t)
			fails++
			continue
		}

		fmt.Fprintf(stdout, "=== OK\t%v\t%s\n", time.Since(start), t)
	}

	if fails > 0 {
		return fmt.Errorf("%d failures", fails)
	}
	return nil
}

type Test struct {
	Bin    string
	Args   []string
	Env    []string // key=value
	Dir    string
	Stdout io.Writer
	Stderr io.Writer
}

func (t Test) String() string {
	return t.Bin + " " + strings.Join(t.Args, " ")
}

func runtest(ctx context.Context, t Test) error {
	cmd := exec.CommandContext(ctx, t.Bin, t.Args...)

	cmd.Env = t.Env
	cmd.Dir = t.Dir
	cmd.Stdout = t.Stdout
	cmd.Stderr = t.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("run: %w", err)
	}

	return nil
}
