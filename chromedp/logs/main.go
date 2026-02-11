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
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/gorilla/websocket"
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
	CdpWSDefault = "ws://127.0.0.1:9222"
)

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		noregister = flags.Bool("no-register", false, "Don't enable logs register")
		cdpws      = flags.String("cdp", env("CDPCLI_WS", CdpWSDefault), "cdp ws to connect")
	)

	// usage func declaration.
	exec := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s]\n", exec)
		fmt.Fprintf(stderr, "Log all received when enabling Page, Network and Log.\n")
		fmt.Fprintf(stderr, "\nCommand line options:\n")
		flags.PrintDefaults()
		fmt.Fprintf(stderr, "\nEnvironment vars:\n")
		fmt.Fprintf(stderr, "\tCDPCLI_WS\tdefault %s\n", CdpWSDefault)
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	// connect to the browser
	wsdialer := &websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := wsdialer.DialContext(ctx, *cdpws, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close() // nolint: errcheck

	if err := write(conn, "Target.setAutoAttach", Params{
		"autoAttach":             true,
		"waitForDebuggerOnStart": false,
		"flatten":                true,
	}, ""); err != nil {
		return fmt.Errorf("write msg: %w", err)
	}

	var sessionId string
	for {
		if err := ctx.Err(); err != nil {
			// end of the context
			return nil
		}

		// We don't setup a ReadDeadline here. We want to be sure to watch
		// until the disconnects.
		if err := conn.SetReadDeadline(time.Time{}); err != nil {
			slog.Debug("watch set read deadline", slog.Any("err", err))
			continue
		}

		t, rawmsg, err := conn.ReadMessage()
		if err != nil {
			slog.Debug("watch read message", slog.Any("err", err))
			continue
		}

		if t != 1 {
			continue
		}

		// decode the message
		var msg Msg
		if err := json.Unmarshal(rawmsg, &msg); err != nil {
			slog.Error("watch decode msg", slog.Any("err", err))
			continue
		}

		if msg.Id != 0 {
			// the message is a result from a command, ignore it.
			continue
		}
		if msg.Method == "" {
			fmt.Println("ERR", string(rawmsg))
			continue
		}

		fmt.Fprintf(stdout, "%s\n", rawmsg)

		switch msg.Method {
		case TargetAttachedToTarget:
			// detach from previous targets
			if sessionId != "" {
				if err := write(conn, "Target.DetachFromTarget", Params{}, sessionId); err != nil {
					slog.Error("watch dettach from target", slog.Any("err", err))
				}
			}

			if *noregister {
				continue
			}

			sessionId, err = handleAttachedToTarget(ctx, msg)
			if err != nil {
				slog.Error("watch handle attached to target", slog.Any("err", err))
				continue
			}

			// Register to receive all network events.
			if err := write(conn, "Network.enable", Params{}, sessionId); err != nil {
				slog.Debug("network enable", slog.Any("err", err))
			}
			// Register to receive all logs events.
			if err := write(conn, "Log.enable", Params{}, sessionId); err != nil {
				slog.Debug("log enable", slog.Any("err", err))
			}
			// Register to receive all page events.
			if err := write(conn, "Page.enable", Params{}, sessionId); err != nil {
				slog.Debug("page enable", slog.Any("err", err))
			}
		}
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

var id = 0

func write(conn *websocket.Conn, method string, prms Params, sessionId string) error {
	id++

	rq := req{
		Id:        id,
		SessionId: sessionId,
		Method:    method,
		Params:    prms,
	}

	b, err := json.Marshal(rq)
	if err != nil {
		return fmt.Errorf("encode: %w", err)
	}

	if err := conn.SetWriteDeadline(time.Now().Add(time.Millisecond * 100)); err != nil {
		return fmt.Errorf("set write deadline: %w", err)
	}

	if err := conn.WriteMessage(1, b); err != nil {
		return fmt.Errorf("write message: %w", err)
	}

	return nil
}

type Method string

const (
	TargetAttachedToTarget Method = "Target.attachedToTarget"
	PageScreencastFrame    Method = "Page.screencastFrame"
)

type Msg struct {
	Id     int
	Result json.RawMessage // set only if id is set

	Method Method
	Params json.RawMessage // set only if Method is set
}

type Params map[string]any

type req struct {
	Id        int    `json:"id"`
	SessionId string `json:"sessionId,omitempty"`
	Method    string `json:"method"`
	Params    Params `json:"params,omitempty"`
}

func handleAttachedToTarget(ctx context.Context, msg Msg) (string, error) {
	// https://chromedevtools.github.io/devtools-protocol/tot/Target/#event-attachedToTarget
	type Params struct {
		SessionId string
	}

	// decode parameters
	var params Params
	if err := json.Unmarshal(msg.Params, &params); err != nil {
		return "", fmt.Errorf("decode params: %w", err)
	}

	return params.SessionId, nil
}
