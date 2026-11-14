# perf

Performance scenarios for lightpanda, compared between binaries by
instruction count instead of wall time.

## Against a browser you started

```
# browser repo, terminal 1
zig build -Doptimize=fast run -- serve --port 9222

# demo repo, terminal 2
cd perf
go run . -connect 127.0.0.1:9222 -out main.json

# switch branch, rebuild, restart the browser, then
go run . -connect 127.0.0.1:9222 -out mybranch.json
go run . -compare main.json,mybranch.json
```

The harness finds the process listening on the port and attaches
`perf stat -p` to it for the duration of each scenario. What a scenario loads
(iframes, workers, stylesheets, images) is set over CDP with
`LP.configureLoading`, so no extra serve flags are needed. `style-anim` is
skipped: `--experimental-features animation` has no CDP switch.

A debug build works, but its numbers only compare with another debug build,
and safety checks can hide or exaggerate a change. Use `-Doptimize=fast` for
anything you'd report. RSS is less meaningful in this mode: the process keeps
the memory of earlier scenarios, and the peak only resets to the current RSS.

## Two binaries, A/B (what CI does)

```
cd perf
go run . -bin main=/path/to/main/lightpanda,pr=/path/to/pr/lightpanda [-rounds 3] [-scenarios style,layout] [-out results.json] [-v]
```

The first binary is the baseline. Rounds run the binaries interleaved. For
each run, the harness starts `perf stat -e instructions:u,task-clock --
lightpanda serve`, drives one scenario with `driver.js` (puppeteer), reads
the peak RSS, then kills the browser. `work Mins` is the median instruction
count minus the `idle` scenario, which is process startup plus the CDP
connection (only the connection with `-connect`).

Exit status 1 when, against the baseline:
- a scenario's instructions grow more than `-max-ins-pct` (default 3%),
- the network scenario's wall time grows more than `-max-wall-pct` (default 15%),
- the number of requests the browser made changes.

Needs `perf` with user-space counters (`kernel.perf_event_paranoid` ≤ 2) and
`npm install` at the repo root.

## Scenarios

Pages live in `public/perf/<name>/`. Each exposes `window.__perf`, a promise
that resolves with counters once the page's work is done, so the driver waits
with a single Runtime.evaluate and no polling.

| scenario | what | gate |
|---|---|---|
| idle | connect, open and close a page | baseline only |
| campfire | the old `puppeteer/cdp.js` flow | instructions |
| network | scripts (sync, defer, async, module, inserted), stylesheets around a blocking script, images, fetch + XHR; every subresource delayed 40ms (`?delay=40`, built-in server) | wall time |
| frames | src, nested, srcdoc and document.write iframes, a worker, postMessage round trips | instructions |
| style | class toggles, inline styles, insertRule, replaceSync, `<style>` churn, custom properties, each followed by a read; `?only=<step>` runs one step | instructions |
| style-anim | same page with `--experimental-features animation` | instructions |
| layout | geometry reads mixed with mutations, IntersectionObserver while scrolling | instructions |
| gbcr | getBoundingClientRect over every element of one wide parent (4000 cards): cold pass, warm pass, append + measure, 2000 inline siblings, IntersectionObserver on every card (#4576) | instructions |
| hittest | elementFromPoint / elementsFromPoint, then 40 clicks and 20 hovers through CDP Input events, on a page whose rules read `:focus` and `:focus-within` | instructions |
| dom | innerHTML, cloneNode, selectors, MutationObserver, TreeWalker, serialization | instructions |
| render | framework commits: components built off-DOM (detached attribute writes, innerHTML), batched inserts/removals/moves/text/class updates into live lists, form controls, keyed `:has`, then one measure phase | instructions |
| cdp | DOM.getDocument, AX tree, LP.getMarkdown / getSemanticTree / getInteractiveElements, page.content() | instructions |

## Noise

Same binary against itself, 5 rounds (2026-11-11, laptop): instructions
within 0.18% on every scenario, wall time up to 14%. Network wall time
within 0.1%, since latency dominates it. `-connect` vs `-bin` on the same
binary: work within 0.25% on every scenario (worker threads started after
perf attaches are counted).
