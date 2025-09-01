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
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"

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

	err := run(ctx, os.Args, os.Stdout, os.Stderr, os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(exitFail)
	}

	os.Exit(exitOK)
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer, stdin io.Reader) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose = flags.Bool("verbose", false, "enable debug log level")
	)

	// usage func declaration.
	exec := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s [<urls>]\n", exec)
		fmt.Fprintf(stderr, "chromedp fetch urls with chrome and lightpanda.\n")
		fmt.Fprintf(stderr, "if no urls are given in argument, the program expects a lsit of URL from stdin.\n")
		fmt.Fprintf(stderr, "We use multi tabs for Chrome and multiple instances for Lightpanda\n")
		fmt.Fprintf(stderr, "\nCommand line options:\n")
		flags.PrintDefaults()
		fmt.Fprintf(stderr, "\nEnvironment vars:\n")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	if *verbose {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}

	urls := flags.Args()
	if len(urls) == 0 {
		// read URLs from stdin
		slog.Info("start reading stdin")
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			line := scanner.Text()
			if len(line) == 0 {
				break
			}
			urls = append(urls, line)
		}
		if err := scanner.Err(); err != nil {
			return fmt.Errorf("read stdin: %w", err)
		}
	}

	metric, err := runChrome(ctx, urls)
	if err != nil {
		return fmt.Errorf("run chrome: %w", err)
	}

	fmt.Fprintln(stdout, "## chrome")
	metric.Write(stdout)

	metric, err = runLightpanda(ctx, "/home/pierre/wrk/browser/zig-out/bin/lightpanda", urls)
	if err != nil {
		return fmt.Errorf("run lightpanda: %w", err)
	}

	fmt.Fprintln(stdout, "## lightpanda")
	metric.Write(stdout)

	return nil
}

type Metric struct {
	Duration time.Duration
	MaxRSS   int64
}

func (m Metric) Write(w io.Writer) {
	fmt.Fprintf(w, "run duration\t%v\n", m.Duration)
	fmt.Fprintf(w, "max rss (Mb)\t%v\n", float64(m.MaxRSS)/1024)
}

func waitready(ctx context.Context, addr string) {
	dialer := net.Dialer{
		Timeout: 200 * time.Millisecond,
	}
	// try to connect to the browser until it responds
	for {
		// ensure context is not done.
		if err := ctx.Err(); err != nil {
			return
		}

		conn, err := dialer.DialContext(ctx, "tcp", addr)
		if err != nil {
			// slog.Debug("tcp", slog.Any("err", err), slog.String("addr", addr))
			continue
		}
		conn.Close()
		break
	}
}

func runChrome(ctx context.Context, urls []string) (*Metric, error) {
	start := time.Now()
	// start chrome manually
	const host, port = "127.0.0.1", "9223"
	args := []string{
		"--headless=new",
		"--remote-debugging-address=" + host,
		"--remote-debugging-port=" + port,
		"--window-size=1200,800",
		"--no-first-run",
		"--disk-cache-dir=/dev/null",
		"--user-dir=/dev/null",
	}

	ctx, cmdcancel := context.WithCancel(ctx)
	defer cmdcancel()

	slog.Debug("starting browser")
	cmd := exec.CommandContext(ctx, "chromium", args...)
	// cmd.Stderr = os.Stderr
	// cmd.Stdout = os.Stdout

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start chrome: %w", err)
	}
	defer cmd.Wait()

	// wait addr is active
	const addr = host + ":" + port
	waitready(ctx, addr)
	slog.Debug("browser ready")

	ctx, cancel := chromedp.NewRemoteAllocator(ctx, "http://"+addr)
	defer cancel()

	opts := []chromedp.ContextOption{
		// chromedp.WithDebugf(log.Printf),
	}

	var ws sync.WaitGroup
	for _, url := range urls {
		ws.Add(1)
		func() {
			defer ws.Done()

			slog.Debug("connect to the browser")
			ctx, cancel := chromedp.NewContext(ctx, opts...)

			// Create a new context (tab) for each URL
			slog.Debug("create new tab", slog.Any("url", url))
			ctxtab, canceltab := chromedp.NewContext(ctx)
			err := chromedp.Run(ctxtab,
				chromedp.Navigate(url),
				chromedp.WaitReady("title"),
			)

			canceltab()
			cancel()
			slog.Debug("end tab", slog.Any("url", url))

			if err != nil {
				slog.Error("tab nav error", slog.Any("err", err))
				return
			}
		}()
	}
	ws.Wait()

	cmdcancel()
	cmd.Wait()

	m := Metric{
		Duration: time.Since(start),
	}

	su := cmd.ProcessState.SysUsage()
	if v, ok := su.(*syscall.Rusage); ok {
		m.MaxRSS = v.Maxrss
	}

	return &m, nil
}

func runLightpanda(ctx context.Context, path string, urls []string) (*Metric, error) {
	start := time.Now()

	const host = "127.0.0.1"

	// chout := make(chan int64, len(urls))
	chout := make(chan int64, len(urls))

	var ws sync.WaitGroup
	for i, url := range urls {
		ws.Add(1)
		func() {
			defer ws.Done()

			port := strconv.Itoa(9222 + i)
			ctx, cmdcancel := context.WithCancel(ctx)
			defer cmdcancel()

			cmd := exec.CommandContext(ctx, path,
				"serve",
				"--host", host,
				"--port", port,
				"--log_level", "debug",
			)

			// cmd.Stderr = os.Stderr
			// cmd.Stdout = os.Stdout

			if err := cmd.Start(); err != nil {
				slog.Error("start lightpanda", slog.Any("err", err))
				cmdcancel()
				return
			}
			defer cmd.Wait()

			// wait addr is active
			addr := host + ":" + port
			waitready(ctx, addr)
			slog.Debug("browser ready")

			ctx, cancel := chromedp.NewRemoteAllocator(ctx,
				"ws://"+addr, chromedp.NoModifyURL,
			)
			defer cancel()

			opts := []chromedp.ContextOption{
				// chromedp.WithDebugf(log.Printf),
			}

			slog.Debug("connect to the browser")
			ctx, cancel = chromedp.NewContext(ctx, opts...)

			err := chromedp.Run(ctx,
				chromedp.Navigate(url),
				chromedp.WaitReady("title"),
			)

			cancel()
			slog.Debug("end tab", slog.Any("url", url))

			if err != nil {
				slog.Error("tab nav error", slog.Any("err", err))
				cmdcancel()
				return
			}

			cmdcancel()
			cmd.Wait()

			slog.Debug("end browser")

			su := cmd.ProcessState.SysUsage()
			if v, ok := su.(*syscall.Rusage); ok {
				chout <- v.Maxrss
			}
		}()
	}
	ws.Wait()
	close(chout)

	m := Metric{
		Duration: time.Since(start),
	}

	for rss := range chout {
		m.MaxRSS += rss
	}

	return &m, nil
}
