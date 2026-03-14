package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

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
