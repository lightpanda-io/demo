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
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/chromedp/chromedp"
	"golang.org/x/sync/errgroup"
)

// stringSliceFlag is a flag type that allows multiple values
type stringSliceFlag []string

func (s *stringSliceFlag) String() string {
	return strings.Join(*s, ", ")
}

func (s *stringSliceFlag) Set(value string) error {
	*s = append(*s, value)
	return nil
}

// matchPattern checks if s matches the pattern with optional wildcards.
// Patterns:
//   - "foo"   -> exact match
//   - "*foo"  -> s ends with "foo"
//   - "foo*"  -> s starts with "foo"
//   - "*foo*" -> s contains "foo"
func matchPattern(s, pattern string) bool {
	if pattern == "" {
		return false
	}

	startsWithWild := strings.HasPrefix(pattern, "*")
	endsWithWild := strings.HasSuffix(pattern, "*")

	// Trim wildcards to get the core pattern
	core := strings.TrimPrefix(pattern, "*")
	core = strings.TrimSuffix(core, "*")

	if core == "" {
		return true // "*" or "**" matches everything
	}

	switch {
	case startsWithWild && endsWithWild:
		return strings.Contains(s, core)
	case startsWithWild:
		return strings.HasSuffix(s, core)
	case endsWithWild:
		return strings.HasPrefix(s, core)
	default:
		return s == core
	}
}

const (
	exitOK   = 0
	exitFail = 1

	CDPTimeout = 10 * time.Second
)

// main starts interruptable context and runs the program.
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	err := run(ctx, os.Args, os.Stdout, os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(exitFail)
	}

	os.Exit(exitOK)
}

const (
	CdpWSDefault   = "ws://127.0.0.1:9222"
	WPTAddrDefault = "http://web-platform.test:8000"
)

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose     = flags.Bool("verbose", false, "enable debug log level")
		wptAddr     = flags.String("wpt-addr", env("WPT_ADDR", WPTAddrDefault), "WPT server address")
		cdp         = flags.String("cdp", env("CDP_WS", CdpWSDefault), "cdp ws to connect, incompatible w/ lpdpath")
		concurrency = flags.Uint("concurrency", 10, "concurrency tests runner")
		outjson     = flags.Bool("json", false, "format output in JSON")
		outsummary  = flags.Bool("summary", false, "Display a summary")
		lpdpath     = flags.String("lpd-path", os.Getenv("LPD_PATH"), "Lightpanda path. If set, it enables autorestart lightpanda process.")
		pool        = flags.Uint("pool", 1, "browser pool, lpd-path is required, concurrency must be greater or equal to pool")
		ml          = flags.Uint("mem-limit", 0, "memory limit for a browser, in MB, only for linux")
		list        = flags.Bool("list", false, "Only list test cases")
		exclude     stringSliceFlag
	)
	flags.Var(&exclude, "exclude", "exclude pattern (can be specified multiple times, supports *wildcards*)")

	// usage func declaration.
	bin := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s\n", bin)
		fmt.Fprintf(stderr, "Run WPT test via a CDP connection\n")
		fmt.Fprintf(stderr, "\nCommand line options:\n")
		flags.PrintDefaults()
		fmt.Fprintf(stderr, "\nEnvironment vars:\n")
		fmt.Fprintf(stderr, "\tWPT_ADDR\tdefault %s\n", WPTAddrDefault)
		fmt.Fprintf(stderr, "\tCDP_WS\tdefault %s\n", CdpWSDefault)
		fmt.Fprintf(stderr, "\tLPD_PATH\n")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	if *verbose {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}

	if *pool > 1 && *lpdpath == "" {
		return fmt.Errorf("--lp-path is required for --pool option")
	}

	if *ml > 0 && *lpdpath == "" {
		return fmt.Errorf("--lp-path is required for --mem-limit option")
	}

	if *ml > 0 && runtime.GOOS != "linux" {
		return fmt.Errorf("--mem-limit option is availble only on linux os")
	}

	filters := flags.Args()

	// fetch the manifest
	tests, err := fetchManifest(ctx, *wptAddr)
	if err != nil {
		return fmt.Errorf("manifest: %w", err)
	}
	slog.Info("test suite", slog.Any("length", len(tests)))

	// Only list all tests.
	if *list {
		for _, t := range tests {
			fmt.Fprintf(stdout, "%s\n", t)
		}
		return nil
	}

	// queue channel is used to dispatch the tests from the producer to runners.
	queue := make(chan string)
	// testresults channel pipes test results from the runners to the reporter.
	testresults := make(chan *TestResult)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	wg, ctx := errgroup.WithContext(ctx)

	var browser Browser = NoopBrowser{CDP: *cdp}
	if *lpdpath != "" {
		if *pool > 1 {
			browser = NewPoolBrowser(*lpdpath, *pool, (*ml)*1024*1024)
		} else {
			browser = &ProcessBrowser{
				Port:     9222,
				Path:     *lpdpath,
				Memlimit: (*ml) * 1024 * 1024,
			}
		}
	}

	// start the browser
	if err := browser.Start(ctx); err != nil {
		return fmt.Errorf("start browser: %w", err)
	}
	defer browser.Stop()

	// start the producer which append tests urls into queue.
	wg.Go(func() error {
		defer close(queue)

		hasFilters := len(filters) > 0

	NEXT:
		for _, t := range tests {
			// apply filters (include patterns)
			matchFilter := false
			for _, filter := range filters {
				if strings.Contains(t, filter) {
					matchFilter = true
					break
				}
			}
			if hasFilters && !matchFilter {
				continue
			}

			// apply ignore patterns (exclude patterns)
			for _, pattern := range exclude {
				if matchPattern(t, pattern) {
					continue NEXT
				}
			}

			select {
			case <-ctx.Done():
				return nil
			case queue <- t:
				// nothing here
			}
		}
		return nil
	})

	// start the pool of runners which take a test url from the queue, run the
	// test and publish result into testresults.
	wg.Go(func() error {
		defer close(testresults)
		pool, ctx := errgroup.WithContext(ctx)

		for range *concurrency {
			pool.Go(func() error {
				for {
					var cdp string
					select {
					case <-ctx.Done():
						return nil
					case t, ok := <-queue:
						if !ok {
							return nil
						}

						slog.Debug("wait for browser readyness", slog.String("test", t))
						select {
						case <-ctx.Done():
							return nil
						case cdp, _ = <-browser.Ready():
							// continue
						}

						res, err := runtest(ctx, cdp, *wptAddr, t)
						if err != nil {
							// We use debug here to avoid useless output.
							slog.Debug("run test error", slog.String("test", t), slog.Any("err", err))

							// we start the browser again and continue to next tests
							res = &TestResult{
								Name:    t,
								Message: err.Error(),

								// This is not always the test which really
								// crash. Because of the concurrency, we don't
								// detect the crash test exactly. But the test
								// fails b/c the browser was missing, mostly
								// due to a previous crash...
								Crash: true,
							}
						}
						testresults <- res
					}
				}
			})
		}
		return pool.Wait()
	})

	// start the reporter reading testresults.
	wg.Go(func() error {
		var encoder *json.Encoder
		if *outjson {
			fmt.Fprint(stdout, "[")
			defer fmt.Fprint(stdout, "]")
			encoder = json.NewEncoder(stdout)
		}

		first := true
		for res := range testresults {
			if *outjson {
				if first {
					first = false
				} else {
					fmt.Fprint(stdout, ",")
				}
				encoder.Encode(res)
				continue
			}

			// text output
			if *outsummary || res.Message == "" {
				fmt.Fprintf(stdout, "%s %d/%d\t%q\n",
					FormatSuccess(res.Pass, res.Crash), res.CountOK(), res.Total(), res.Name,
				)
			} else {
				fmt.Fprintf(stdout, "%s %d/%d\t%q\n\t%q\n",
					FormatSuccess(res.Pass, res.Crash), res.CountOK(), res.Total(), res.Name, res.Message,
				)
			}

			if *outsummary {
				continue
			}

			// Details
			for _, c := range res.Cases {
				if c.Message == "" {
					fmt.Fprintf(stdout, "\t%s\t%q\n",
						FormatSuccess(c.Pass, false), c.Name,
					)
				} else {
					fmt.Fprintf(stdout, "\t%s\t%q\n\t\t%q\n",
						FormatSuccess(c.Pass, false), c.Name, c.Message,
					)
				}
			}
		}

		return nil
	})

	if err := wg.Wait(); err != nil {
		return fmt.Errorf("wg: %w", err)
	}

	browser.Stop()

	return nil
}

type TestCase struct {
	Pass    bool   `json:"pass"`
	Name    string `json:"name"`
	Message string `json:"message,omitempty"`
}

type TestResult struct {
	Pass    bool          `json:"pass"`
	Crash   bool          `json:"crash"`
	Name    string        `json:"name"`
	Message string        `json:"message,omitempty"`
	Cases   []TestCase    `json:"cases"`
	Elapsed time.Duration `json:"elapsed"`
}

func FormatSuccess(pass bool, crash bool) string {
	if crash {
		return "Crash"
	}

	if pass {
		return "Pass"
	}

	return "Fail"
}

func (r *TestResult) Total() int {
	return len(r.Cases)
}

func (r *TestResult) CountOK() int {
	cpt := 0
	for _, c := range r.Cases {
		if c.Pass {
			cpt++
		}
	}

	return cpt
}

// runtest connect to the browser, navigates to the test url and get the test
// results.
func runtest(ctx context.Context, cdp, addr, test string) (*TestResult, error) {
	u := addr + test
	slog.Debug("run test", slog.String("test", test), slog.String("cdp", cdp), slog.String("url", u))

	res := &TestResult{Name: test}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	ctx, cancel = chromedp.NewRemoteAllocator(ctx,
		cdp, chromedp.NoModifyURL,
	)
	defer cancel()

	ctx, cancel = chromedp.NewContext(ctx)
	defer cancel()

	start := time.Now()
	err := chromedp.Run(ctx, chromedp.Navigate(u))
	if err != nil {
		switch {
		case errors.Is(err, syscall.ECONNREFUSED),
			errors.Is(err, syscall.ECONNABORTED),
			errors.Is(err, syscall.ECONNRESET):
			return nil, fmt.Errorf("%s: navigate: %w", test, err)
		}
		res.Elapsed = time.Since(start)
		res.Message = strings.TrimSpace(err.Error())
		return res, nil
	}

	var status, report string
	_ = chromedp.Run(ctx,
		chromedp.Poll(`report.complete === true`, nil,
			chromedp.WithPollingInterval(500*time.Millisecond),
			chromedp.WithPollingTimeout(5*time.Second),
		),
	) // ignore errors here, we try to always get the result.

	err = chromedp.Run(ctx,
		chromedp.Evaluate(`report.status;`, &status),
		chromedp.Evaluate(`report.log;`, &report),
	)
	res.Elapsed = time.Since(start)

	// invalid test result.
	if err != nil {
		switch {
		case errors.Is(err, syscall.ECONNREFUSED),
			errors.Is(err, syscall.ECONNABORTED),
			errors.Is(err, syscall.ECONNRESET):
			return nil, fmt.Errorf("%s: eval: %w", test, err)
		}

		res.Message = strings.TrimSpace(err.Error())
		return res, nil
	}

	// parse the log
	res.Pass = true
	lines := strings.Split(strings.TrimSpace(report), "\n")
NEXT:
	for _, l := range lines {

		for i, status := range []string{"|Pass", "|Fail", "|Timeout", "|Not Run", "|Optional Feature Unsupported"} {
			name, msg, ok := strings.Cut(l, status)
			if !ok {
				continue
			}

			pass := i == 0
			if !pass {
				res.Pass = false
			}

			res.Cases = append(res.Cases, TestCase{
				Pass:    pass,
				Name:    strings.TrimSpace(name),
				Message: strings.TrimSpace(msg),
			})
			continue NEXT
		}

		res.Cases = append(res.Cases, TestCase{
			Pass:    false,
			Name:    "Invalid report format",
			Message: l,
		})

	}

	return res, nil
}

// env returns the env value corresponding to the key or the default string.
func env(key, dflt string) string {
	val, ok := os.LookupEnv(key)
	if !ok {
		return dflt
	}

	return val
}
