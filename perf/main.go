// Copyright 2023-2026 Lightpanda (Selecy SAS)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// perf runs the performance scenarios against one or more lightpanda
// binaries, rounds interleaved, and compares each binary to the first one.
//
// Each run starts `lightpanda serve` under `perf stat`, drives one scenario
// with ../perf/driver.js, then stops the browser. Instruction counts are the
// main metric: they barely move with machine load, unlike wall or CPU time.
// The network scenario is the exception: it measures wall time on purpose,
// with latency injected by the built-in HTTP server.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

type gate int

const (
	gateInstructions gate = iota // fail on instruction count growth
	gateWall                     // fail on wall time growth
	gateNone                     // reported only
)

type scenario struct {
	name string
	// What to load, sent by the driver with LP.configureLoading, so it also
	// works against a browser we didn't start (-connect).
	loading string
	// Extra serve flags with no CDP equivalent. Skipped with -connect.
	flags []string
	iters int // iterations inside one browser run
	gate  gate
}

// The idle scenario is subtracted from the others, so a scenario's "work"
// excludes process startup and the CDP connection.
var scenarios = []scenario{
	{name: "idle", iters: 1, gate: gateNone},
	{name: "campfire", iters: 20, gate: gateInstructions},
	{name: "network", loading: `{"externalStylesheets":true,"images":true}`, iters: 5, gate: gateWall},
	{name: "frames", loading: `{"subFrame":true,"worker":true,"externalStylesheets":true}`, iters: 10, gate: gateInstructions},
	{name: "style", iters: 2, gate: gateInstructions},
	{name: "style-anim", flags: []string{"--experimental-features", "animation"}, iters: 2, gate: gateInstructions},
	{name: "layout", iters: 2, gate: gateInstructions},
	{name: "hittest", iters: 2, gate: gateInstructions},
	{name: "dom", iters: 2, gate: gateInstructions},
	{name: "cdp", iters: 5, gate: gateInstructions},
}

// bin is either a binary we start per run (path) or a browser that's
// already running (addr + pid).
type bin struct {
	name string
	path string
	addr string
	pid  int
}

type result struct {
	Scenario     string         `json:"scenario"`
	Bin          string         `json:"bin"`
	Round        int            `json:"round"`
	Instructions int64          `json:"instructions"` // user space, whole process
	TaskClockMs  float64        `json:"task_clock_ms"`
	WallMs       float64        `json:"wall_ms"` // sum of the driver's per-iteration times
	PeakRSSKB    int64          `json:"peak_rss_kb"`
	Requests     int64          `json:"requests"`
	Counters     map[string]any `json:"counters,omitempty"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(2)
	}
}

func run() error {
	var (
		binsFlag  = flag.String("bin", "", "comma separated binaries, name=path or path; the first one is the baseline")
		connect   = flag.String("connect", "", "measure an already running `lightpanda serve` at host:port instead of -bin")
		name      = flag.String("name", "local", "label for the -connect results")
		compare   = flag.String("compare", "", "compare saved -out files (base.json,new.json,...) without running anything")
		rounds    = flag.Int("rounds", 3, "rounds per scenario, binaries interleaved within a round")
		only      = flag.String("scenarios", "", "comma separated scenarios to run (default: all)")
		out       = flag.String("out", "", "write all results as JSON to this file")
		addr      = flag.String("http-addr", "127.0.0.1:1240", "address of the built-in http server")
		maxIns    = flag.Float64("max-ins-pct", 3, "fail when a scenario's instructions grow more than this, in %")
		maxWall   = flag.Float64("max-wall-pct", 15, "fail when the network scenario's wall time grows more than this, in %")
		verbose   = flag.Bool("v", false, "print every run")
		publicDir = flag.String("public", "../public", "directory served over http")
	)
	flag.Parse()

	selected, err := selectScenarios(*only)
	if err != nil {
		return err
	}

	if *compare != "" {
		bins, all, err := load(strings.Split(*compare, ","))
		if err != nil {
			return err
		}
		selected = present(selected, all)
		if failed := report(os.Stdout, selected, bins, summarizeAll(selected, bins, all), *maxIns, *maxWall); failed {
			os.Exit(1)
		}
		return nil
	}

	var bins []bin
	if *connect != "" {
		if *binsFlag != "" {
			return errors.New("-bin and -connect are exclusive")
		}
		pid, err := listenerPid(*connect)
		if err != nil {
			return err
		}
		bins = []bin{{name: *name, addr: *connect, pid: pid}}
		selected = slices.DeleteFunc(selected, func(sc scenario) bool {
			if len(sc.flags) > 0 {
				fmt.Fprintf(os.Stderr, "skipping %s: needs %v at startup\n", sc.name, sc.flags)
				return true
			}
			return false
		})
	} else if bins, err = parseBins(*binsFlag); err != nil {
		return err
	}
	if _, err := exec.LookPath("perf"); err != nil {
		return errors.New("perf not found in PATH")
	}

	srv := newServer(*publicDir)
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	go http.Serve(ln, srv)
	baseURL := "http://" + ln.Addr().String()

	var all []result
	for _, sc := range selected {
		for round := range *rounds {
			for _, b := range bins {
				r, err := runOne(sc, b, round, baseURL, srv)
				if err != nil {
					return fmt.Errorf("%s on %s: %w", sc.name, b.name, err)
				}
				if *verbose {
					fmt.Fprintf(os.Stderr, "%-11s %-10s r%d ins=%d task=%.0fms wall=%.0fms rss=%dKB req=%d\n",
						sc.name, b.name, round, r.Instructions, r.TaskClockMs, r.WallMs, r.PeakRSSKB, r.Requests)
				} else {
					fmt.Fprint(os.Stderr, ".")
				}
				all = append(all, r)
			}
		}
	}
	fmt.Fprintln(os.Stderr)

	sums := summarizeAll(selected, bins, all)
	if *out != "" {
		data, err := json.MarshalIndent(output{Env: environment(), Runs: all, Summary: sums}, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(*out, data, 0o644); err != nil {
			return err
		}
	}

	if failed := report(os.Stdout, selected, bins, sums, *maxIns, *maxWall); failed {
		os.Exit(1)
	}
	return nil
}

func parseBins(s string) ([]bin, error) {
	if s == "" {
		return nil, errors.New("-bin or -connect is required")
	}
	var bins []bin
	for _, part := range strings.Split(s, ",") {
		name, path, ok := strings.Cut(part, "=")
		if !ok {
			path = name
			name = fmt.Sprintf("bin%d", len(bins))
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			return nil, err
		}
		if _, err := os.Stat(abs); err != nil {
			return nil, err
		}
		bins = append(bins, bin{name: name, path: abs})
	}
	return bins, nil
}

func selectScenarios(s string) ([]scenario, error) {
	if s == "" {
		return scenarios, nil
	}
	names := strings.Split(s, ",")
	// idle is always needed: it's the startup baseline.
	if !slices.Contains(names, "idle") {
		names = append([]string{"idle"}, names...)
	}
	var out []scenario
	for _, sc := range scenarios {
		if slices.Contains(names, sc.name) {
			out = append(out, sc)
		}
	}
	if len(out) != len(names) {
		return nil, fmt.Errorf("unknown scenario in %q", s)
	}
	return out, nil
}

// server serves the public dir. `?delay=<ms>` on any request delays the
// response, which is how the network scenario simulates latency. It counts
// requests so a change in what the browser loads shows up.
type server struct {
	files    http.Handler
	requests atomic.Int64
}

func newServer(dir string) *server {
	return &server{files: http.FileServer(http.Dir(dir))}
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.requests.Add(1)
	if d := r.URL.Query().Get("delay"); d != "" {
		if ms, err := strconv.Atoi(d); err == nil {
			time.Sleep(time.Duration(ms) * time.Millisecond)
		}
	}
	if strings.HasSuffix(r.URL.Path, "/perf/network/data.json") {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"items":[1,2,3,4,5]}`)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.files.ServeHTTP(w, r)
}

func runOne(sc scenario, b bin, round int, baseURL string, srv *server) (result, error) {
	if b.path == "" {
		return attachOne(sc, b, round, baseURL, srv)
	}
	res := result{Scenario: sc.name, Bin: b.name, Round: round}

	port, err := freePort()
	if err != nil {
		return res, err
	}

	tmp, err := os.CreateTemp("", "lp-perf-*.csv")
	if err != nil {
		return res, err
	}
	tmp.Close()
	defer os.Remove(tmp.Name())

	args := []string{"stat", "-x,", "-o", tmp.Name(), "-e", "instructions:u,task-clock", "--",
		b.path, "serve", "--log-level", "fatal", "--host", "127.0.0.1", "--port", strconv.Itoa(port)}
	args = append(args, sc.flags...)
	cmd := exec.Command("perf", args...)
	// Own process group, so cleanup also reaches lightpanda under perf.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Env = append(os.Environ(), "LIGHTPANDA_DISABLE_TELEMETRY=true")
	if err := cmd.Start(); err != nil {
		return res, err
	}
	stopped := false
	defer func() {
		if stopped == false {
			syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			cmd.Wait()
		}
	}()

	if err := waitPort(port, 10*time.Second); err != nil {
		return res, err
	}
	lpPid, err := childPid(cmd.Process.Pid)
	if err != nil {
		return res, err
	}

	if err := drive(&res, sc, "127.0.0.1:"+strconv.Itoa(port), baseURL, srv); err != nil {
		return res, err
	}

	// Read the peak RSS before the process goes away.
	res.PeakRSSKB, _ = vmHWM(lpPid)

	syscall.Kill(lpPid, syscall.SIGKILL)
	cmd.Wait() // perf exits with the child's status, ignore it
	stopped = true

	res.Instructions, res.TaskClockMs, err = parsePerf(tmp.Name())
	return res, err
}

// attachOne measures one scenario on a browser that's already running:
// perf attaches to it for the duration of the scenario only.
func attachOne(sc scenario, b bin, round int, baseURL string, srv *server) (result, error) {
	res := result{Scenario: sc.name, Bin: b.name, Round: round}

	tmp, err := os.CreateTemp("", "lp-perf-*.csv")
	if err != nil {
		return res, err
	}
	tmp.Close()
	defer os.Remove(tmp.Name())

	// Reset the peak RSS to the current RSS, so VmHWM is this scenario's.
	os.WriteFile(fmt.Sprintf("/proc/%d/clear_refs", b.pid), []byte("5"), 0)

	cmd := exec.Command("perf", "stat", "-x,", "-o", tmp.Name(), "-e", "instructions:u,task-clock",
		"-p", strconv.Itoa(b.pid))
	if err := cmd.Start(); err != nil {
		return res, err
	}
	stopped := false
	defer func() {
		if stopped == false {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	// perf has no ready signal. The browser is idle until the driver
	// connects, so waiting a bit loses nothing.
	time.Sleep(300 * time.Millisecond)

	if err := drive(&res, sc, b.addr, baseURL, srv); err != nil {
		return res, err
	}
	res.PeakRSSKB, _ = vmHWM(b.pid)

	cmd.Process.Signal(os.Interrupt)
	cmd.Wait()
	stopped = true

	res.Instructions, res.TaskClockMs, err = parsePerf(tmp.Name())
	return res, err
}

// drive runs driver.js for one scenario against the browser at addr.
func drive(res *result, sc scenario, addr, baseURL string, srv *server) error {
	srv.requests.Store(0)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	driver := exec.CommandContext(ctx, "node", "driver.js", sc.name)
	driver.Env = append(os.Environ(),
		"BROWSER_ADDRESS=ws://"+addr,
		"BASE_URL="+baseURL,
		"ITERATIONS="+strconv.Itoa(sc.iters),
		"LOADING="+sc.loading,
	)
	driver.Stderr = os.Stderr
	output, err := driver.Output()
	if err != nil {
		return fmt.Errorf("driver: %w", err)
	}
	res.Requests = srv.requests.Load()

	var d struct {
		WallMs   []float64      `json:"wall_ms"`
		Counters map[string]any `json:"counters"`
	}
	if err := json.Unmarshal(output, &d); err != nil {
		return fmt.Errorf("driver output %q: %w", output, err)
	}
	for _, w := range d.WallMs {
		res.WallMs += w
	}
	res.Counters = d.Counters
	return nil
}

// listenerPid finds the process listening on addr's port, via the socket
// inode in /proc/net/tcp{,6} and the fds in /proc/*/fd.
func listenerPid(addr string) (int, error) {
	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return 0, err
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return 0, err
	}
	want := fmt.Sprintf(":%04X", port)
	inodes := map[string]bool{}
	for _, f := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n")[1:] {
			fields := strings.Fields(line)
			// local_address, st == 0A (LISTEN), inode
			if len(fields) > 9 && strings.HasSuffix(fields[1], want) && fields[3] == "0A" {
				inodes["socket:["+fields[9]+"]"] = true
			}
		}
	}
	if len(inodes) == 0 {
		return 0, fmt.Errorf("nothing listens on %s", addr)
	}
	procs, _ := filepath.Glob("/proc/[0-9]*/fd/*")
	for _, fd := range procs {
		if link, err := os.Readlink(fd); err == nil && inodes[link] {
			return strconv.Atoi(strings.Split(fd, "/")[2])
		}
	}
	return 0, fmt.Errorf("no process of ours owns the listener on %s", addr)
}

// load reads results saved with -out. Each file's runs are renamed after
// the file, so two runs of the same -name compare.
func load(paths []string) ([]bin, []result, error) {
	var bins []bin
	var all []result
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			return nil, nil, err
		}
		var o output
		if len(data) > 0 && data[0] == '[' {
			// Files from before the summary: just the runs.
			err = json.Unmarshal(data, &o.Runs)
		} else {
			err = json.Unmarshal(data, &o)
		}
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", p, err)
		}
		rs := o.Runs
		name := strings.TrimSuffix(filepath.Base(p), ".json")
		for i := range rs {
			rs[i].Bin = name
		}
		bins = append(bins, bin{name: name})
		all = append(all, rs...)
	}
	return bins, all, nil
}

// present keeps the scenarios that have results.
func present(selected []scenario, all []result) []scenario {
	return slices.DeleteFunc(slices.Clone(selected), func(sc scenario) bool {
		return slices.IndexFunc(all, func(r result) bool { return r.Scenario == sc.name }) < 0
	})
}

func freePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

func waitPort(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		c, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(port))
		if err == nil {
			c.Close()
			return nil
		}
		time.Sleep(20 * time.Millisecond)
	}
	return fmt.Errorf("lightpanda didn't listen on %d", port)
}

// childPid returns the pid of the process perf started.
func childPid(perfPid int) (int, error) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/task/%d/children", perfPid, perfPid))
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(data))
	if len(fields) != 1 {
		return 0, fmt.Errorf("perf has %d children", len(fields))
	}
	return strconv.Atoi(fields[0])
}

func vmHWM(pid int) (int64, error) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if v, ok := strings.CutPrefix(line, "VmHWM:"); ok {
			return strconv.ParseInt(strings.TrimSuffix(strings.TrimSpace(v), " kB"), 10, 64)
		}
	}
	return 0, errors.New("no VmHWM")
}

func parsePerf(path string) (ins int64, taskMs float64, err error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Split(line, ",")
		if len(f) < 3 {
			continue
		}
		switch {
		case strings.HasPrefix(f[2], "instructions"):
			ins, err = strconv.ParseInt(f[0], 10, 64)
			if err != nil {
				return 0, 0, fmt.Errorf("instructions %q (perf_event_paranoid?): %w", f[0], err)
			}
		case strings.HasPrefix(f[2], "task-clock"):
			taskMs, _ = strconv.ParseFloat(f[0], 64)
		}
	}
	if ins == 0 {
		return 0, 0, fmt.Errorf("no instruction count in perf output:\n%s", data)
	}
	return ins, taskMs, nil
}

func median(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := slices.Clone(v)
	slices.Sort(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}

// output is what -out writes: every run, plus the medians per binary and
// scenario that the report and perf-fmt use.
type output struct {
	Env     map[string]string             `json:"env"`
	Runs    []result                      `json:"runs"`
	Summary map[string]map[string]summary `json:"summary"` // bin -> scenario
}

type summary struct {
	// Median instructions minus the idle scenario's median.
	WorkInstructions int64   `json:"work_instructions"`
	Instructions     int64   `json:"instructions"`
	TaskClockMs      float64 `json:"task_clock_ms"`
	WallMs           float64 `json:"wall_ms"`
	PeakRSSKB        int64   `json:"peak_rss_kb"`
	Requests         int64   `json:"requests"`

	requests []int64 // per round, compared exactly
}

func summarizeAll(selected []scenario, bins []bin, all []result) map[string]map[string]summary {
	out := map[string]map[string]summary{}
	for _, b := range bins {
		idle := summarize(all, "idle", b.name, 0)
		out[b.name] = map[string]summary{}
		for _, sc := range selected {
			s := idle
			if sc.name != "idle" {
				s = summarize(all, sc.name, b.name, idle.Instructions)
			}
			out[b.name][sc.name] = s
		}
	}
	return out
}

func summarize(all []result, sc, b string, idleIns int64) summary {
	var ins, task, wall, rss []float64
	var s summary
	for _, r := range all {
		if r.Scenario != sc || r.Bin != b {
			continue
		}
		ins = append(ins, float64(r.Instructions))
		task = append(task, r.TaskClockMs)
		wall = append(wall, r.WallMs)
		rss = append(rss, float64(r.PeakRSSKB))
		s.requests = append(s.requests, r.Requests)
	}
	s.Instructions = int64(median(ins))
	s.WorkInstructions = s.Instructions - idleIns
	s.TaskClockMs = median(task)
	s.WallMs = median(wall)
	s.PeakRSSKB = int64(median(rss))
	if len(s.requests) > 0 {
		s.Requests = s.requests[0]
	}
	return s
}

// environment records what else the numbers depend on, so a jump in the
// history can be told apart from a code change.
func environment() map[string]string {
	env := map[string]string{}
	if out, err := exec.Command("git", "-C", "..", "rev-parse", "HEAD").Output(); err == nil {
		env["demo_commit"] = strings.TrimSpace(string(out))
	}
	if out, err := exec.Command("node", "--version").Output(); err == nil {
		env["node"] = strings.TrimSpace(string(out))
	}
	if data, err := os.ReadFile("../node_modules/puppeteer-core/package.json"); err == nil {
		var pkg struct {
			Version string `json:"version"`
		}
		if json.Unmarshal(data, &pkg) == nil {
			env["puppeteer"] = pkg.Version
		}
	}
	if data, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
		env["kernel"] = strings.TrimSpace(string(data))
	}
	if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if v, ok := strings.CutPrefix(line, "model name"); ok {
				env["cpu"] = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(v), ":"))
				break
			}
		}
	}
	return env
}

func pct(base, v float64) float64 {
	if base == 0 {
		return 0
	}
	return (v - base) / base * 100
}

// report prints one line per scenario and binary, with the delta to the
// first binary, and returns whether a gate failed.
func report(w io.Writer, selected []scenario, bins []bin, sums map[string]map[string]summary, maxIns, maxWall float64) bool {
	failed := false
	fmt.Fprintf(w, "%-11s %-10s %12s %8s %9s %8s %9s %8s %7s %5s\n",
		"scenario", "bin", "work Mins", "Δ%", "task ms", "wall ms", "Δ%", "rss MB", "Δ%", "reqs")
	for _, sc := range selected {
		base := sums[bins[0].name][sc.name]
		for i, b := range bins {
			s := sums[b.name][sc.name]
			work, baseWork := float64(s.WorkInstructions), float64(base.WorkInstructions)
			dIns, dWall, dRSS := pct(baseWork, work), pct(base.WallMs, s.WallMs), pct(float64(base.PeakRSSKB), float64(s.PeakRSSKB))

			mark := ""
			if i > 0 {
				if sc.gate == gateInstructions && dIns > maxIns {
					mark += " FAIL:instructions"
				}
				if sc.gate == gateWall && dWall > maxWall {
					mark += " FAIL:wall"
				}
				if slices.Equal(base.requests, s.requests) == false {
					mark += " FAIL:requests"
				}
			}
			if mark != "" {
				failed = true
			}
			fmt.Fprintf(w, "%-11s %-10s %12.1f %+7.2f%% %9.0f %8.0f %+8.1f%% %8.1f %+6.1f%% %5d%s\n",
				sc.name, b.name, work/1e6, dIns, s.TaskClockMs, s.WallMs, dWall, float64(s.PeakRSSKB)/1024, dRSS, s.Requests, mark)
		}
	}
	return failed
}
