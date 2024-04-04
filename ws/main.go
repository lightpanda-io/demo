package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
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

	fmt.Fprintf(os.Stderr, "expose dir: %q\nlisten: %q\n", dir, address)

	// Simple static webserver:
	log.Fatal(http.ListenAndServe(address, http.FileServer(http.Dir(dir))))
}
