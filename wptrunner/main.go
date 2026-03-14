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
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
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

// fetchManifest request /MANIFEST.json file and extract test harness test urls.
func fetchManifest(ctx context.Context, addr string) ([]string, error) {
	u, err := url.JoinPath(addr, "MANIFEST.json")
	if err != nil {
		return nil, fmt.Errorf("create url: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, fmt.Errorf("new req: %w", err)
	}

	cli := http.Client{
		Timeout: CDPTimeout,
	}
	resp, err := cli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do req: %w", err)
	}
	defer resp.Body.Close()

	var manifest struct {
		Items struct {
			Testharness map[string]json.RawMessage `json:"testharness"`
		} `json:"items"`
		URLBase string `json:"url_base"`
		Version int    `json:"version"`
	}

	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&manifest); err != nil {
		return nil, fmt.Errorf("json decode: %w", err)
	}

	base := manifest.URLBase
	if base == "" {
		base = "/"
	}

	urls := make([]string, 0, 4000)
	if err := walkManifest(manifest.Items.Testharness, "", base, &urls); err != nil {
		return nil, err
	}

	// Keep results in same order.
	sort.Strings(urls)

	return urls, nil
}

// walkManifest recursively walks the testharness directory tree.
// Leaves are entries whose value is a JSON array (not an object).
func walkManifest(node map[string]json.RawMessage, pathPrefix, base string, urls *[]string) error {
	for key, raw := range node {
		// Determine whether this value is an object (subdirectory) or array (file entry).
		trimmed := json.RawMessage(raw)
		if len(trimmed) == 0 {
			continue
		}

		switch trimmed[0] {
		case '{':
			// Subdirectory — recurse.
			var sub map[string]json.RawMessage
			if err := json.Unmarshal(trimmed, &sub); err != nil {
				return fmt.Errorf("unmarshal subdir %q: %w", key, err)
			}
			if err := walkManifest(sub, pathPrefix+"/"+key, base, urls); err != nil {
				return err
			}

		case '[':
			// File entry: ["<hash>", [<url_or_null>, <opts>], ...]
			// The array may contain multiple test variants.
			var entry []json.RawMessage
			if err := json.Unmarshal(trimmed, &entry); err != nil {
				return fmt.Errorf("unmarshal entry %q: %w", key, err)
			}
			// entry[0] is the hash string; entry[1..] are variants.
			filePath := pathPrefix + "/" + key
			for _, variantRaw := range entry[1:] {
				// Each variant is [<url_or_null>, <options_object>]
				var variant [2]json.RawMessage
				if err := json.Unmarshal(variantRaw, &variant); err != nil {
					return fmt.Errorf("unmarshal variant for %q: %w", key, err)
				}
				var u string
				if string(variant[0]) == "null" {
					// Construct URL from tree path.
					u = base + filePath[1:] // strip leading "/"
				} else {
					// Explicit URL provided (strip surrounding quotes).
					if err := json.Unmarshal(variant[0], &u); err != nil {
						return fmt.Errorf("unmarshal url for %q: %w", key, err)
					}
					u = base + u
				}
				*urls = append(*urls, u)
			}
		}
	}
	return nil
}

// memUsage returns the resident memory usage in bytes of the process
// behind a running exec.Cmd by reading /proc/<pid>/statm.
func memUsage(cmd *exec.Cmd) (uint64, error) {
	if cmd.Process == nil {
		return 0, fmt.Errorf("process not started")
	}

	pid := cmd.Process.Pid

	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/statm", pid))
	if err != nil {
		return 0, fmt.Errorf("read statm: %w", err)
	}

	// statm fields: size resident shared text lib data dt (all in pages)
	fields := strings.Fields(strings.TrimSpace(string(data)))
	if len(fields) < 2 {
		return 0, fmt.Errorf("unexpected statm format")
	}

	rssPages, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse rss: %w", err)
	}

	pageSize := uint64(os.Getpagesize())
	return rssPages * pageSize, nil
}

type Browser interface {
	Start(context.Context) error
	Stop()
	Ready() <-chan string
}

type NoopBrowser struct {
	CDP string
}

func (b NoopBrowser) Start(_ context.Context) error {
	return nil
}
func (b NoopBrowser) Stop() {}
func (b NoopBrowser) Ready() <-chan string {
	ch := make(chan string, 1)
	ch <- b.CDP
	return ch
}

type ProcessBrowser struct {
	sync.Mutex

	Path     string
	Port     int
	Memlimit uint

	ready   chan struct{}
	running bool
	done    chan struct{}
	cancel  context.CancelFunc
}

func (b *ProcessBrowser) Stop() {
	b.Lock()
	defer b.Unlock()

	b.cancel()
	<-b.done
}

var ErrBrowserIsRunning = errors.New("browser is running")

func (b *ProcessBrowser) CDP() string {
	return fmt.Sprintf("ws://127.0.0.1:%d", b.Port)
}

// non blocking
func (b *ProcessBrowser) Start(ctx context.Context) error {
	b.Lock()
	defer b.Unlock()

	if b.running {
		return ErrBrowserIsRunning
	}

	cmd := exec.CommandContext(ctx, b.Path,
		"serve",
		"--log_level", "error",
		"--port", strconv.Itoa(b.Port),
		"--insecure_disable_tls_host_verification",
	)

	ctx, b.cancel = context.WithCancel(ctx)

	slog.Info("starting browser", slog.String("cmd", cmd.String()))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start command: %w", err)
	}

	b.ready = make(chan struct{})
	b.done = make(chan struct{})

	if b.Memlimit > 0 {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Millisecond * 500):
					rss, err := memUsage(cmd)
					if err != nil {
						slog.Error("mem check error", slog.Any("err", err))
						continue
					}
					if rss > uint64(b.Memlimit) {
						slog.Info("memory limit exceeded, stopping browser",
							slog.Uint64("rss", rss),
							slog.Uint64("limit", uint64(b.Memlimit)),
						)
						// kill the process.
						// It will be auto-restarted
						if err := cmd.Process.Kill(); err != nil {
							slog.Error("kill process on mem limit", slog.Any("err", err))
						}
						return
					}
				}
			}
		}()
	}

	go func() {
		defer close(b.done)
		defer b.cancel()

		// Wait for readyness
		time.Sleep(time.Second * 1)
		close(b.ready)

		// block until the end
		if err := cmd.Wait(); err != nil {
			slog.Debug("browser stop", slog.Any("err", err))
		}

		if ctx.Err() != nil {
			return

		}

		// reset state
		b.Lock()
		b.ready = make(chan struct{})
		b.running = false
		b.Unlock()

		// autorestart
		if err := b.Start(ctx); err != nil {
			slog.Error("browser restart", slog.Any("err", err))
			return
		}
	}()

	return nil
}

// blocks until done
func (b *ProcessBrowser) Ready() <-chan string {
	b.Lock()
	defer b.Unlock()

	r := make(chan string)
	go func() {
		<-b.ready
		r <- b.CDP()
		close(r)
	}()

	return r
}

type PoolBrowser struct {
	procs  []*ProcessBrowser
	cancel context.CancelFunc
}

func NewPoolBrowser(path string, n, ml uint) *PoolBrowser {
	procs := make([]*ProcessBrowser, n)
	port := 9222
	for i := range n {
		procs[i] = &ProcessBrowser{
			Memlimit: ml,
			Port:     port + int(i),
			Path:     path,
		}
	}

	return &PoolBrowser{
		procs: procs,
	}
}

func (b *PoolBrowser) Stop() {
	b.cancel()
	for _, p := range b.procs {
		p.Stop()
	}
}

// non blocking
func (b *PoolBrowser) Start(ctx context.Context) error {
	ctx, b.cancel = context.WithCancel(ctx)
	for i, p := range b.procs {
		if err := p.Start(ctx); err != nil {
			b.cancel()
			return fmt.Errorf("start %d: %w", i, err)
		}
	}

	return nil
}

func (b *PoolBrowser) Ready() <-chan string {
	i := rand.Intn(len(b.procs))
	bb := b.procs[i]
	return bb.Ready()
}
