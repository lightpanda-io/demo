// Copyright 2023-2024 Lightpanda (Selecy SAS)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

func main() {
	address := os.Getenv("WS_ADDRESS")
	if address == "" {
		address = ":1234"
	}

	dir := os.Getenv("WS_DIR")
	if dir == "" {
		dir = "public"
	}

	handler := Handler{
		next: http.FileServer(http.Dir(dir)),
		wait: time.Duration(0),
	}

	if wait := os.Getenv("WS_WAIT"); wait != "" {
		v, err := strconv.Atoi(wait)
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid wait value: %v", err)
		}
		handler.wait = time.Duration(v) * time.Millisecond
	}

	fmt.Fprintf(os.Stderr, "expose dir: %q\nlisten: %q\n", dir, address)

	// Simple static webserver:
	log.Fatal(http.ListenAndServe(address, handler))
}

type Handler struct {
	next http.Handler
	wait time.Duration
}

func (s Handler) ServeHTTP(res http.ResponseWriter, req *http.Request) {
	if s.wait > 0 {
		time.Sleep(s.wait)
	}

	switch req.URL.Path {
	case "/cookies/set":
		http.SetCookie(res, &http.Cookie{
			Name:  "lightpanda",
			Value: "browser",
		})
	case "/cookies/get":
		enc := json.NewEncoder(res)
		if err := enc.Encode(req.Cookies()); err != nil {
			fmt.Fprintf(os.Stderr, "encode json: %v", err)
			res.WriteHeader(500)
		}
	case "/form/submit":
		defer req.Body.Close()
		body, err := io.ReadAll(req.Body)
		if err != nil {
			panic(err)
		}

		res.Header().Add("Content-Type", "text/html")
		res.Write([]byte("<html><ul><li id=method>"))
		res.Write([]byte(req.Method))
		res.Write([]byte("<li id=body>"))
		res.Write(body)
		res.Write([]byte("<li id=query>"))
		res.Write([]byte(req.URL.RawQuery))
		res.Write([]byte("</ul>"))
	default:
		s.next.ServeHTTP(res, req)
	}
}
