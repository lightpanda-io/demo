package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
)

const ReqReadLimit = 64 * 1024

var (
	ErrUnsupportedH2     = errors.New("unsupported http2")
	ErrUnsupportedMethod = errors.New("unsupported method")
	ErrNoAuth            = errors.New("no auth")
	ErrInvalidAuth       = errors.New("invalid auth")
)

func readRequest(r io.Reader) (*http.Request, error) {
	r = io.LimitReader(r, ReqReadLimit)
	br := bufio.NewReader(r)

	return http.ReadRequest(br)
}

func writeResp(c net.Conn, status int) error {
	_, err := fmt.Fprintf(c,
		"HTTP/1.1 %d %s\r\n\r\n",
		status,
		http.StatusText(status),
	)
	return err
}

// Handle manages a proxy client connection.
// Handle parses incoming request, dials the outgoing conn and connect it
// to the client.
func (s *Server) HandleHTTP(ctx context.Context, cli net.Conn) error {
	log := slog.With(slog.Any("addr", cli.RemoteAddr()))

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// read the request
	req, err := readRequest(cli)
	if err != nil {
		_ = writeResp(cli, http.StatusBadRequest)
		return fmt.Errorf("read req: %w", err)
	}

	log = log.With(slog.String("host", req.Host))

	log.Debug("handle conn")
	defer log.Debug("end conn")

	// auth
	if auth := s.auth; auth != nil {
		var err error
		req, err = auth.Authenticate(ctx, req)
		if err != nil {
			_ = writeUnauthorized(cli)
			return fmt.Errorf("dial srv: %w", err)
		}
	}

	srv, err := s.bck.DialContext(ctx, req)
	if err != nil {
		_ = writeResp(cli, http.StatusBadGateway)
		return fmt.Errorf("dial srv: %w", err)
	}
	defer srv.Close()

	// if the client send a CONNECT method, return a OK status code before
	// proxify.
	if req.Method == http.MethodConnect {
		if err := writeResp(cli, http.StatusOK); err != nil {
			return fmt.Errorf("connect ok: %w", err)
		}
	} else {
		// forward the request to the server.
		if err := req.Write(srv); err != nil {
			_ = writeResp(cli, http.StatusBadGateway)
			return fmt.Errorf("forward req: %w", err)
		}
	}

	log.Debug("proxy conns")

	// connect cli with out
	return Proxy(ctx, cli, srv)
}

func writeUnauthorized(c net.Conn) error {
	_, err := fmt.Fprintf(c,
		"HTTP/1.1 %d %s\r\nProxy-Authenticate: Basic realm=\"Lightpanda\"\r\nProxy-Connection: close\r\n\r\n",
		http.StatusProxyAuthRequired,
		http.StatusText(http.StatusProxyAuthRequired),
	)
	return err
}
