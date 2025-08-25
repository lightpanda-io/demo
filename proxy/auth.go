package main

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
)

type BasicAuth struct {
	Username string
	Password string
}

func (a BasicAuth) Authenticate(ctx context.Context, req *http.Request) (*http.Request, error) {
	u, p, ok := proxyBasicAuth(req)
	if !ok {
		return nil, ErrNoAuth
	}

	if u != a.Username || p != a.Password {
		return nil, ErrInvalidAuth
	}

	// remove the Proxy-Auth header
	req.Header.Del("Proxy-Authorization")

	return req, nil
}

// proxyBasicAuth retrieve basic auth from Proxy-Authorization
func proxyBasicAuth(req *http.Request) (username, password string, ok bool) {
	auth := req.Header.Get("Proxy-Authorization")
	if auth == "" {
		return "", "", false
	}
	return parseBasicAuth(auth)
}

// parseBasicAuth parses an HTTP Basic Authentication string.
// "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==" returns ("Aladdin", "open sesame", true).
// Copy of net/http/request.go
func parseBasicAuth(auth string) (username, password string, ok bool) {
	const prefix = "Basic "
	// Case insensitive prefix match. See Issue 22736.
	if len(auth) < len(prefix) || !asciiEqualFold(auth[:len(prefix)], prefix) {
		return "", "", false
	}
	c, err := base64.StdEncoding.DecodeString(auth[len(prefix):])
	if err != nil {
		return "", "", false
	}
	cs := string(c)
	username, password, ok = strings.Cut(cs, ":")
	if !ok {
		return "", "", false
	}
	return username, password, true
}

// asciiEqualFold is [strings.EqualFold], ASCII only. It reports whether s and t
// are equal, ASCII-case-insensitively.
// Copy of net/http/internal/ascii/print.go
func asciiEqualFold(s, t string) bool {
	if len(s) != len(t) {
		return false
	}
	for i := 0; i < len(s); i++ {
		if lower(s[i]) != lower(t[i]) {
			return false
		}
	}
	return true
}

// lower returns the ASCII lowercase version of b.
// Copy of net/http/internal/ascii/print.go
func lower(b byte) byte {
	if 'A' <= b && b <= 'Z' {
		return b + ('a' - 'A')
	}
	return b
}
