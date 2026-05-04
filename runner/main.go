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
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
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
		httpWait = flags.Int("http-wait", envInt("RUNNER_HTTP_WAIT", 0), "per-response delay in ms")
		serve    = flags.Bool("serve", false, "only run the http servers, skip the integration tests")
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
		fmt.Fprintf(stderr, "\tRUNNER_HTTP_WAIT\tdefault 0 (ms)\n")
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

	wait := time.Duration(*httpWait) * time.Millisecond

	// In serve-only mode, just run the http servers and block.
	if *serve {
		return runhttp(ctx, *httpAddr, *httpDir, wait)
	}

	// Start the http server in its own goroutine.
	go func() {
		if err := runhttp(ctx, *httpAddr, *httpDir, wait); err != nil {
			slog.Error("http server", slog.String("err", err.Error()))
		}
	}()

	// Run end to end tests.
	fails := 0
	for _, t := range []Test{
		{Bin: "node", Args: []string{"puppeteer/basic.js"}},
		{Bin: "node", Args: []string{"puppeteer/cdp.js"}, Env: []string{"RUNS=10"}},
		{Bin: "node", Args: []string{"puppeteer/dump.js"}, Env: []string{"URL=http://127.0.0.1:1234/campfire-commerce/"}},
		{Bin: "node", Args: []string{"puppeteer/links.js"}, Env: []string{"URL=http://127.0.0.1:1234/campfire-commerce/"}},
		{Bin: "node", Args: []string{"puppeteer/click.js"}},
		{Bin: "node", Args: []string{"puppeteer/wait_for_network.js"}},
		{Bin: "node", Args: []string{"puppeteer/dynamic_scripts.js"}},
		{Bin: "node", Args: []string{"puppeteer/location_write.js"}},
		{Bin: "node", Args: []string{"puppeteer/form.js"}},
		{Bin: "node", Args: []string{"puppeteer/cookies.js"}},
		{Bin: "node", Args: []string{"puppeteer/multi.js"}},
		{Bin: "node", Args: []string{"puppeteer/frame.js"}},
		{Bin: "node", Args: []string{"puppeteer/cookies-xhr.js"}},
		{Bin: "node", Args: []string{"puppeteer/cookies-redirect-local.js"}},
		{Bin: "node", Args: []string{"puppeteer/request_interception.js"}},
		{Bin: "node", Args: []string{"puppeteer/authenticate.js"}},
		{Bin: "node", Args: []string{"puppeteer/ri_authenticate.js"}},
		{Bin: "node", Args: []string{"puppeteer/ua.js"}},
		{Bin: "node", Args: []string{"puppeteer/pending-page.js"}},
		{Bin: "node", Args: []string{"puppeteer/cache.js"}},
		{Bin: "node", Args: []string{"puppeteer/cache-disable.js"}},
		{Bin: "node", Args: []string{"puppeteer/cache-vary.js"}},
		{Bin: "node", Args: []string{"puppeteer/cache-no-store.js"}},
		{Bin: "node", Args: []string{"playwright/connect.js"}},
		{Bin: "node", Args: []string{"playwright/cdp.js"}, Env: []string{"RUNS=2"}},
		{Bin: "node", Args: []string{"playwright/dump.js"}},
		{Bin: "node", Args: []string{"playwright/links.js"}, Env: []string{"BASE_URL=http://127.0.0.1:1234/campfire-commerce/"}},
		{Bin: "node", Args: []string{"playwright/click.js"}},
		{Bin: "node", Args: []string{"playwright/request_interception.js"}},
		{Bin: "go", Args: []string{"run", "fetch/main.go", "test"}, Dir: "chromedp"},
		{Bin: "go", Args: []string{"run", "links/main.go", "http://127.0.0.1:1234/campfire-commerce/"}, Dir: "chromedp"},
		{Bin: "go", Args: []string{"run", "click/main.go", "http://127.0.0.1:1234/"}, Dir: "chromedp"},
		{Bin: "go", Args: []string{"run", "ri/main.go", "http://127.0.0.1:1234/campfire-commerce/"}, Dir: "chromedp"},
		{Bin: "go", Args: []string{"run", "fromnode/main.go", "http://127.0.0.1:1234/campfire-commerce/"}, Dir: "chromedp"},
		// TODO using --pool=10 blocks the CI which timeout. We need to understand and fix the issue.
		{Bin: "go", Args: []string{"run", "crawler/main.go", "--limit=100", "--pool=1", "http://127.0.0.1:1234/"}, Dir: "chromedp"},
		{Bin: "go", Args: []string{"run", "mconns/main.go", "http://127.0.0.1:1234/"}, Dir: "chromedp"},
		{Bin: "go", Args: []string{"run", "dump/main.go", "http://127.0.0.1:1234/campfire-commerce/"}, Dir: "rod"},
		{Bin: "go", Args: []string{"run", "title/main.go", "http://127.0.0.1:1234/campfire-commerce/"}, Dir: "rod"},

		// add fetch + tls mostly for proxy
		{Bin: "node", Args: []string{"puppeteer/dump.js"}, Env: []string{"URL=https://demo-browser.lightpanda.io/campfire-commerce/"}},
		{Bin: "go", Args: []string{"run", "fetch/main.go", "https://demo-browser.lightpanda.io/campfire-commerce/"}, Dir: "chromedp"},
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
	name := t.Bin
	if t.Dir != "" {
		name = "cd " + t.Dir + "; " + name
	}
	return name + " " + strings.Join(t.Args, " ")
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

// runhttp starts the default and broken-robots servers on consecutive ports
// starting at addr (default on basePort, broken-robots on basePort+1).
// Returns when ctx is canceled or any server errors.
func runhttp(ctx context.Context, addr, dir string, wait time.Duration) error {
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid address %q: %w", addr, err)
	}
	basePort, err := strconv.Atoi(portStr)
	if err != nil {
		return fmt.Errorf("invalid port in %q: %w", addr, err)
	}

	def := DefaultServer{
		next: http.FileServer(http.Dir(dir)),
		wait: wait,
	}
	handlers := []http.Handler{
		def,
		BrokenRobotsServer{DefaultServer: def},
		CacheServer{},
	}

	fmt.Fprintf(os.Stderr, "expose dir: %q\n", dir)

	errCh := make(chan error, len(handlers))
	for i, h := range handlers {
		listenAddr := net.JoinHostPort(host, strconv.Itoa(basePort+i))
		srv := &http.Server{
			Addr:    listenAddr,
			Handler: h,
			BaseContext: func(net.Listener) context.Context {
				return ctx
			},
		}
		fmt.Fprintf(os.Stderr, "listen %T on %q\n", h, listenAddr)

		go func(srv *http.Server) {
			<-ctx.Done()
			if err := srv.Shutdown(context.Background()); err != nil && !errors.Is(err, context.Canceled) {
				slog.Error("http server shutdown",
					slog.String("addr", srv.Addr),
					slog.String("err", err.Error()))
			}
		}(srv)

		go func(srv *http.Server) {
			if err := srv.ListenAndServe(); err != http.ErrServerClosed {
				errCh <- fmt.Errorf("http server %s: %w", srv.Addr, err)
				return
			}
			errCh <- nil
		}(srv)
	}

	return <-errCh
}

type DefaultServer struct {
	next http.Handler
	wait time.Duration
}

func (s DefaultServer) ServeHTTP(res http.ResponseWriter, req *http.Request) {
	if s.wait > 0 {
		time.Sleep(s.wait)
	}

	switch req.URL.Path {
	case "/auth":
		user, pass, ok := req.BasicAuth()
		if !ok || user != "lpd" || pass != "lpd" {
			res.Header().Set("WWW-Authenticate", `Basic realm="Lightpanda"`)
			http.Error(res, "Unauthorized", http.StatusUnauthorized)
			return
		}

		res.Header().Add("Content-Type", "text/html")
		res.Write([]byte("<html><body>Hello</body></html>"))
	case "/cookies/set":
		http.SetCookie(res, &http.Cookie{
			Name:  "lightpanda",
			Value: "browser",
		})
	case "/cookies/redirect":
		http.SetCookie(res, &http.Cookie{
			Name:  "redirect",
			Value: "cookie",
		})
		http.Redirect(res, req, "/cookies/get", http.StatusFound)
	case "/cookies/get":
		enc := json.NewEncoder(res)
		if err := enc.Encode(req.Cookies()); err != nil {
			fmt.Fprintf(os.Stderr, "encode json: %v", err)
			res.WriteHeader(500)
		}
		res.Header().Set("Content-Type", "application/json")
	case "/form/submit":
		defer req.Body.Close()
		body, err := io.ReadAll(req.Body)
		if err != nil {
			panic(err)
		}

		res.Header().Add("Content-Type", "text/html")
		res.Write([]byte("<html><ul><li id=method>"))
		res.Write([]byte(req.Method))
		res.Write([]byte("<li id=body>"))
		res.Write(body)
		res.Write([]byte("<li id=query>"))
		res.Write([]byte(req.URL.RawQuery))
		res.Write([]byte("</ul>"))
	case "/get/headers":
		enc := json.NewEncoder(res)
		if err := enc.Encode(req.Header); err != nil {
			fmt.Fprintf(os.Stderr, "encode json: %v", err)
			res.WriteHeader(500)
		}
		res.Header().Set("Content-Type", "application/json")
	default:
		s.next.ServeHTTP(res, req)
	}
}

// BrokenRobotsServer behaves like DefaultServer, but always returns 500 for /robots.txt
type BrokenRobotsServer struct {
	DefaultServer
}

func (s BrokenRobotsServer) ServeHTTP(res http.ResponseWriter, req *http.Request) {
	if req.URL.Path == "/robots.txt" {
		http.Error(res, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	s.DefaultServer.ServeHTTP(res, req)
}

type CacheServer struct {}

func (s CacheServer) ServeHTTP(res http.ResponseWriter, req *http.Request) {
    path := req.URL.Path

    switch {
    case strings.HasPrefix(path, "/vary/"):
	    req.URL.Path = path[len("/vary"):]
	    res.Header().Set("Cache-Control", "max-age=3600")
	    res.Header().Set("Vary", "X-Internal-Header")
	    res.Header().Set("Content-Type", "text/html")
	    res.Write([]byte("<html><body>vary</body></html>"))

	case strings.HasPrefix(path, "/cache/"):
	    req.URL.Path = path[len("/cache"):]
	    res.Header().Set("Cache-Control", "max-age=3600")
	    res.Header().Set("Content-Type", "text/html")
	    res.Write([]byte("<html><body>cache</body></html>"))

	case strings.HasPrefix(path, "/no-store/"):
	    req.URL.Path = path[len("/no-store"):]
	    res.Header().Set("Cache-Control", "no-store")
	    res.Header().Set("Content-Type", "text/html")
	    res.Write([]byte("<html><body>no-store</body></html>"))

    default:
        http.NotFound(res, req)
    }
}

// env returns the env value corresponding to the key or the default string.
func env(key, dflt string) string {
	val, ok := os.LookupEnv(key)
	if !ok {
		return dflt
	}

	return val
}

// envInt returns the env value parsed as int, or the default on missing/invalid.
func envInt(key string, dflt int) int {
	val, ok := os.LookupEnv(key)
	if !ok {
		return dflt
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return dflt
	}
	return n
}
