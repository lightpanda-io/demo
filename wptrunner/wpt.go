package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
)

// fetchManifest request /MANIFEST.json file and extract test harness test urls.
func fetchManifest(ctx context.Context, addr string) ([]string, error) {
	u, err := url.JoinPath(addr, "MANIFEST.json")
	if err != nil {
		return nil, fmt.Errorf("create url: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, fmt.Errorf("new req: %w", err)
	}

	cli := http.Client{
		Timeout: CDPTimeout,
	}
	resp, err := cli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do req: %w", err)
	}
	defer resp.Body.Close()

	var manifest struct {
		Items struct {
			Testharness map[string]json.RawMessage `json:"testharness"`
		} `json:"items"`
		URLBase string `json:"url_base"`
		Version int    `json:"version"`
	}

	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&manifest); err != nil {
		return nil, fmt.Errorf("json decode: %w", err)
	}

	base := manifest.URLBase
	if base == "" {
		base = "/"
	}

	urls := make([]string, 0, 4000)
	if err := walkManifest(manifest.Items.Testharness, "", base, &urls); err != nil {
		return nil, err
	}

	// Keep results in same order.
	sort.Strings(urls)

	return urls, nil
}

// walkManifest recursively walks the testharness directory tree.
// Leaves are entries whose value is a JSON array (not an object).
func walkManifest(node map[string]json.RawMessage, pathPrefix, base string, urls *[]string) error {
	for key, raw := range node {
		// Determine whether this value is an object (subdirectory) or array (file entry).
		trimmed := json.RawMessage(raw)
		if len(trimmed) == 0 {
			continue
		}

		switch trimmed[0] {
		case '{':
			// Subdirectory — recurse.
			var sub map[string]json.RawMessage
			if err := json.Unmarshal(trimmed, &sub); err != nil {
				return fmt.Errorf("unmarshal subdir %q: %w", key, err)
			}
			if err := walkManifest(sub, pathPrefix+"/"+key, base, urls); err != nil {
				return err
			}

		case '[':
			// File entry: ["<hash>", [<url_or_null>, <opts>], ...]
			// The array may contain multiple test variants.
			var entry []json.RawMessage
			if err := json.Unmarshal(trimmed, &entry); err != nil {
				return fmt.Errorf("unmarshal entry %q: %w", key, err)
			}
			// entry[0] is the hash string; entry[1..] are variants.
			filePath := pathPrefix + "/" + key
			for _, variantRaw := range entry[1:] {
				// Each variant is [<url_or_null>, <options_object>]
				var variant [2]json.RawMessage
				if err := json.Unmarshal(variantRaw, &variant); err != nil {
					return fmt.Errorf("unmarshal variant for %q: %w", key, err)
				}
				var u string
				if string(variant[0]) == "null" {
					// Construct URL from tree path.
					u = base + filePath[1:] // strip leading "/"
				} else {
					// Explicit URL provided (strip surrounding quotes).
					if err := json.Unmarshal(variant[0], &u); err != nil {
						return fmt.Errorf("unmarshal url for %q: %w", key, err)
					}
					u = base + u
				}
				*urls = append(*urls, u)
			}
		}
	}
	return nil
}
