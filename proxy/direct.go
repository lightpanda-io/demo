package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"strings"
)

type DirectTCP struct {
	dialer net.Dialer
}

func (d *DirectTCP) DialContext(ctx context.Context, req *http.Request) (net.Conn, error) {
	// Direct dial the server
	var host string
	if strings.Contains(req.Host, ":") {
		host = req.Host
	} else {
		host = req.Host + ":80"
	}

	slog.Debug("direct tcp dial", slog.Any("host", host))
	return d.dialer.DialContext(ctx, "tcp", host)
}

func (d *DirectTCP) Dial(ctx context.Context, req *http.Request, _, _, _ *string) (net.Conn, error) {
	conn, err := d.DialContext(ctx, req)
	return conn, err
}

func (d *DirectTCP) String() string {
	return "direct tcp dialer"
}
