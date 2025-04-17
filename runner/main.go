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
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
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
	httpAddrDefault = "127.0.0.1:1234"
	httpDirDefault  = "public"
)

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose  = flags.Bool("verbose", false, "enable debug log level")
		httpAddr = flags.String("http-addr", env("RUNNER_HTTP_ADDRESS", httpAddrDefault), "http server address")
		httpDir  = flags.String("http-dir", env("RUNNER_HTTP_DIR", httpDirDefault), "http dir to expose")
	)

	// usage func declaration.
	bin := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s\n", bin)
		fmt.Fprintf(stderr, "end to end tests\n")
		fmt.Fprintf(stderr, "\nCommand line options:\n")
		flags.PrintDefaults()
		fmt.Fprintf(stderr, "\nEnvironment vars:\n")
		fmt.Fprintf(stderr, "\tRUNNER_HTTP_ADDRESS\tdefault %s\n", httpAddrDefault)
		fmt.Fprintf(stderr, "\tRUNNER_HTTP_DIR\tdefault %s\n", httpDirDefault)
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	if *verbose {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}

	args = flags.Args()
	if len(args) != 0 {
		return errors.New("too much arguments")
	}

	// Start the http server in its own goroutine.
	go func() {
		if err := runhttp(ctx, *httpAddr, *httpDir); err != nil {
			slog.Error("http server", slog.String("err", err.Error()))
		}
	}()

	// Run end to end tests.
	for _, tc := range [][]string{
		{"node", "puppeteer/cdp.js"},
		{"node", "puppeteer/dump.js"},
		{"node", "puppeteer/links.js"},
		{"node", "playwright/connect.js"},
	} {
		fmt.Fprintf(stdout, "=== %s\n", strings.Join(tc, " "))
		if err := runtest(ctx, stdout, stderr, tc[0], tc[1:]...); err != nil {
			return fmt.Errorf("run test %s: %w", strings.Join(tc, " "), err)
		}
	}

	return nil
}

func runtest(ctx context.Context, stdout, stderr io.Writer, bin string, args ...string) error {
	cmd := exec.CommandContext(ctx, bin, args...)

	output, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdoutpipe: %w", err)
	}
	go io.Copy(stdout, output)

	erroutput, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderrpipe: %w", err)
	}
	go io.Copy(stderr, erroutput)

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("run: %w", err)
	}

	return nil
}

// run the local http server
func runhttp(ctx context.Context, addr, dir string) error {
	handler := http.FileServer(http.Dir(dir))

	srv := &http.Server{
		Addr:    addr,
		Handler: handler,
		BaseContext: func(net.Listener) context.Context {
			return ctx
		},
	}

	// shutdown api server on context cancelation
	go func(ctx context.Context, srv *http.Server) {
		<-ctx.Done()
		slog.Debug("http server shutting down")
		// we use context.Background() here b/c ctx is already canceled.
		if err := srv.Shutdown(context.Background()); err != nil {
			// context cancellation error is ignored.
			if !errors.Is(err, context.Canceled) {
				slog.Error("http server shutdown", slog.String("err", err.Error()))
			}
		}
	}(ctx, srv)

	// ListenAndServe always returns a non-nil error.
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return fmt.Errorf("http server: %w", err)
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
