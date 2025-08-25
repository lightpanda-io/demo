package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

type Dialer interface {
	DialContext(ctx context.Context, req *http.Request) (net.Conn, error)
}

type Usage interface {
	Usage(ctx context.Context, req *http.Request, started, ended time.Time, in, out int64) error
}

type Server struct {
	ln  net.Listener
	bck Dialer
}

func ListenAndServe(ctx context.Context, bck Dialer, addr string) error {
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s := &Server{
		ln:  l,
		bck: bck,
	}
	defer s.Close()

	slog.Info("server listening", slog.String("addr", addr))

	return s.Serve(ctx)
}

// Close closes the server.
func (s *Server) Close() error {
	return s.ln.Close()
}

func (s *Server) Serve(ctx context.Context) error {
	done := make(chan error, 1)
	go func() {
		defer close(done)
		for {
			if ctx.Err() != nil {
				return
			}
			c, err := s.ln.Accept()
			if err != nil {
				done <- fmt.Errorf("accept: %w", err)
				return
			}

			go func() {
				defer c.Close()
				if err := s.HandleHTTP(ctx, c); err != nil {
					if errors.Is(err, ErrNoAuth) {
						slog.Debug("handle conn", slog.Any("err", err))
					} else {
						slog.Error("handle conn", slog.Any("err", err))
					}
				}
			}()
		}
	}()

	select {
	case <-ctx.Done():
		break
	case err := <-done:
		return err
	}

	// TODO ensure all connections are gracefully stopped.
	return nil
}
