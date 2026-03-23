package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
)

const (
	exitOK   = 0
	exitFail = 1
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
	perfURL = "https://cdn.perf.lightpanda.io"
)

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose = flags.Bool("verbose", false, "enable debug log level")
		list    = flags.Bool("list", false, "list available commits")
		n       = flags.Int("n", 10, "number of runs to list, 0 for all")

		progress = flags.Bool("with-progress", false, "display regression and progression")
	)

	// usage func declaration.
	bin := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s [<commit> [<commit>]]\n", bin)
		fmt.Fprintf(stderr, "Compare WPT test results\n")
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
		return fmt.Errorf("bad arguments")
	}

	cli := NewClient(perfURL)

	// fetch the history list
	runs, err := cli.FetchHistory(ctx)
	if err != nil {
		return fmt.Errorf("history: %w", err)
	}

	nruns := len(runs)

	if *list {
		for _, run := range runs[nruns-*n:] {
			fmt.Fprintf(stdout, "%s\tP %s\tF %s\tC %s\t%v\n",
				run.Date.Format("2006-01-02 15:04"),
				intf(run.Summary.Pass), intf(run.Summary.Fail), intf(run.Summary.Crash),
				run.Commit,
			)
		}
		return nil
	}

	last, prev := runs[nruns-1], runs[nruns-2]

	// compare the last 2 by default
	lasttcs, err := cli.Fetch(ctx, last.Date, last.Commit)
	if err != nil {
		return fmt.Errorf("fetch last: %w", err)
	}

	prevtcs, err := cli.Fetch(ctx, prev.Date, prev.Commit)
	if err != nil {
		return fmt.Errorf("fetch prev: %w", err)
	}

	// Display headers
	fmt.Fprintf(stdout, "Prev %v\t%s\n", prev.Commit, prev.Date.Format("2006-01-02 15:04"))
	fmt.Fprintf(stdout, "Last %v\t%s\n", last.Commit, last.Date.Format("2006-01-02 15:04"))
	fmt.Fprintf(stdout, "https://github.com/lightpanda-io/browser/compare/%v...%v\n",
		prev.Commit, last.Commit,
	)
	fmt.Fprintf(stdout, "\n")

	// Columns headers
	fmt.Fprintf(stdout, "  %12v\t%12v\n", "Prev", "Last")
	fmt.Fprintf(stdout, "  %12v\t%12v\n", prev.Commit, last.Commit)

	// Comparison
	diff := ListDiff(lasttcs, prevtcs)
	for _, d := range diff {
		regression := " "
		if d.Regression {
			regression = ">"
		} else if !*progress {
			// By default display only regressions
			continue
		}

		fmt.Fprintf(stdout, "%s %s %10s\t%s %10s\t%s\n",
			regression,
			tcf(d.Prev), sub(d.Prev),
			tcf(d.Last), sub(d.Last),
			d.Name,
		)
	}

	return nil
}

func sub(tc *TestCase) string {
	n := 0
	for _, s := range tc.SubCases {
		if s.Pass {
			n++
		}
	}
	return fmt.Sprintf("%d/%d", n, len(tc.SubCases))
}

func tcf(tc *TestCase) string {
	if tc == nil {
		return "M"
	}

	if tc.Pass {
		return "P"
	}
	if tc.Crash {
		return "C"
	}

	return "F"
}

func intf(n int) string {
	s := strconv.Itoa(n)
	var buf strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			buf.WriteByte(',')
		}
		buf.WriteRune(c)
	}
	return buf.String()
}
