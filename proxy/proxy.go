package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"time"
)

const ConnMaxDuration = 20 * time.Minute

var ErrProxyTimeout = errors.New("proxy timeout")

type cusage chan int64

// Proxy connects cli and srv until an error or the end of the context.
func Proxy(ctx context.Context,
	cli net.Conn, srv net.Conn,
) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	defer slog.Debug("end proxy", slog.Any("addr", cli.RemoteAddr()))

	// We set a channel with a size of 2 to ensure no go-routine will block if
	// both return error.
	cerr := make(chan error, 2)

	go func() {
		defer slog.Debug("end copy cli to srv", slog.Any("addr", cli.RemoteAddr()))
		defer cancel()

		_, err := io.Copy(srv, cli)

		if err != nil {
			cerr <- fmt.Errorf("copy cli to srv: %w", err)
		}
	}()

	go func() {
		defer slog.Debug("end copy srv to cli", slog.Any("addr", cli.RemoteAddr()))
		defer cancel()

		_, err := io.Copy(cli, srv)

		if err != nil {
			cerr <- fmt.Errorf("copy srv to cli: %w", err)
		}
	}()

	select {
	case <-ctx.Done():
		return nil

	// hard limit of conn proxy.
	case <-time.After(ConnMaxDuration):
		return ErrProxyTimeout

	case err := <-cerr:
		return err
	}
}
