# Lightpanda Demo

This demo repository provides examples, tests and benchmarks for the [Lightpanda
browser](https://github.com/lightpanda-io/browser/).

## Benchmarks

The methodology and results are available in [benchmarks](./BENCHMARKS.md) page.

* `ws/` contains a Go web server program,
* `public/` contains demo websites used by the benchmarks,

## Examples

You can find script examples to use the browser with different librairies.

* `puppeteer/` contains [Puppeteer](https://pptr.dev/) examples in Javascript.
* `playwright/` contains [Playwright](https://playwright.dev/) examples in Javascript.
* `chromedp/` contains [chromedp](https://github.com/chromedp/chromedp) examples in Go.
* `rod/` contains [go-rod](https://github.com/go-rod/rod) examples in Go.

## Tests

* `runner/` contains a Go program running many of examples scripts against local demo website
* `integration/` contains a Go program running scripts against real world websites.

## Tools

* `amiibo/` contains a Go program to generate the `public/amiibo/` example website.
* `proxy/` is an Go HTTP proxy used for tests.
