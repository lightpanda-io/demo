package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
)

type LightpandaCmd struct {
	Port     int
	Memlimit uint
	Path     string
}

func (c LightpandaCmd) Command(ctx context.Context) (*exec.Cmd, error) {
	// prepare cache unique dir
	cache, err := os.MkdirTemp(os.TempDir(), "wpt_cache")
	if err != nil {
		return nil, fmt.Errorf("create cache dir: %w", err)
	}

	args := []string{
		"serve",
		"--log-level", "error",
		"--port", strconv.Itoa(c.Port),
		"--ws-max-concurrent", "64",
		"--insecure-disable-tls-host-verification",
		"--load-resources", "iframe",
		"--load-resources", "image",
		"--load-resources", "worker",
		"--load-resources", "stylesheet",
		"--http-cache-dir", cache,
		"--experimental-features", "cors",
	}

	if limit := c.Memlimit; limit > 0 {
		args = append(args, "--v8-max-heap-mb", strconv.Itoa(int(c.Memlimit)))
	}

	return exec.CommandContext(ctx, c.Path, args...), nil
}

func (c LightpandaCmd) CDP() string {
	return fmt.Sprintf("ws://127.0.0.1:%d", c.Port)
}

func (c LightpandaCmd) Copy(port int) BrowserCmd {
	c.Port = port
	return c
}
