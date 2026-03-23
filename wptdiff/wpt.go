package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Client struct {
	baseurl string
	cli     *http.Client
}

func NewClient(baseurl string) *Client {
	return &Client{
		baseurl: baseurl,
		cli:     &http.Client{},
	}
}

type Commit string

func (c Commit) String() string {
	if len(c) < 8 {
		return string(c)
	}
	return string(c[0:8])
}

type Run struct {
	Commit  Commit    `json:"commit"`
	Date    time.Time `json:"datetime"`
	Summary struct {
		Pass  int `json:"pass"`
		Fail  int `json:"fail"`
		Crash int `json:"crash"`
	} `json:"data"`
}

func (c *Client) FetchHistory(ctx context.Context) ([]Run, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseurl+"/wpt/history.json", nil)
	if err != nil {
		return nil, fmt.Errorf("new req: %w", err)
	}

	resp, err := c.cli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do req: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("bad status: %d", resp.StatusCode)
	}

	var runs []Run
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&runs); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}

	return runs, nil
}

type TestCase struct {
	Name     string      `json:"name"`
	Message  string      `json:"message"`
	Pass     bool        `json:"pass"`
	Crash    bool        `json:"crash"`
	SubCases []*TestCase `json:"cases"`
	Elapsed  int         `json:"elapsed"`
}

func (c *Client) Fetch(ctx context.Context, date time.Time, commit Commit) ([]*TestCase, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf(
		"%s/wpt/%s_%s.json",
		c.baseurl, date.Format("2006-01-02_15-04"), string(commit),
	),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("new req: %w", err)
	}

	resp, err := c.cli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do req: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("bad status: %d", resp.StatusCode)
	}

	var tcs []*TestCase
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&tcs); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}

	return tcs, nil
}
