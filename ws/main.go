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
	"fmt"
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

	handler := http.FileServer(http.Dir(dir))
	wait := os.Getenv("WS_WAIT")
	if wait != "" {
		v, err := strconv.Atoi(wait)
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid wait value: %v", err)
		}

		handler = Slower{
			next: handler,
			wait: time.Duration(v) * time.Millisecond,
		}
	}

	fmt.Fprintf(os.Stderr, "expose dir: %q\nlisten: %q\n", dir, address)

	// Simple static webserver:
	log.Fatal(http.ListenAndServe(address, handler))
}

type Slower struct {
	next http.Handler
	wait time.Duration
}

func (s Slower) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	time.Sleep(s.wait)
	s.next.ServeHTTP(w, r)
}
