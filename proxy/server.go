package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
)

type Dialer interface {
	DialContext(ctx context.Context, req *http.Request) (net.Conn, error)
}

type Auth interface {
	Authenticate(ctx context.Context, req *http.Request) (*http.Request, error)
}

type Server struct {
	ln   net.Listener
	bck  Dialer
	auth Auth
}

func ListenAndServe(ctx context.Context, auth Auth, bck Dialer, addr string) error {
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s := &Server{
		ln:   l,
		bck:  bck,
		auth: auth,
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
