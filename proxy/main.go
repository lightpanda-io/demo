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
	proxyAddrDefault = "127.0.0.1:3000"
)

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose   = flags.Bool("verbose", false, "enable debug log level")
		username  = flags.String("proxy-username", os.Getenv("PROXY_USERNAME"), "proxy auth username")
		password  = flags.String("proxy-password", os.Getenv("PROXY_PASSWORD"), "proxy auth password")
		proxyAddr = flags.String("proxy-addr", env("PROXY_ADDRESS", proxyAddrDefault), "http proxy address")
	)

	// usage func declaration.
	bin := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s\n", bin)
		fmt.Fprintf(stderr, "HTTP proxy\n")
		fmt.Fprintf(stderr, "\nCommand line options:\n")
		flags.PrintDefaults()
		fmt.Fprintf(stderr, "\nEnvironment vars:\n")
		fmt.Fprintf(stderr, "\tPROXY_ADDRESS\tdefault %s\n", proxyAddrDefault)
		fmt.Fprintf(stderr, "\tPROXY_USERNAME\n")
		fmt.Fprintf(stderr, "\tPROXY_PASSWORD\n")
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

	var auth Auth = nil
	if *username != "" || *password != "" {
		auth = BasicAuth{Username: *username, Password: *password}
	}

	return runproxy(ctx, *proxyAddr, auth)
}

// run the local http proxy
func runproxy(ctx context.Context, addr string, auth Auth) error {
	if err := ListenAndServe(ctx, auth, &DirectTCP{}, addr); err != nil {
		return fmt.Errorf("proxy server: %w", err)
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
