# Navigation rate limit test

Measures the per-host navigation rate limiter (`--http-nav-delay`) from both
sides: the client that asks for the pages, and the server that receives the
requests.

Everything runs in one node process: an HTTP server, a puppeteer client, and
one `lightpanda serve` per mode. Because the server and the client share a
clock, the two points of view line up exactly.

## Run it

```sh
node rate-limit/bench.js
```

It takes about one minute with the defaults. It compares three settings:

| mode | flag | what it does |
|---|---|---|
| `off` | `--http-nav-delay 0` | no rate limit at all |
| `fixed100` | `--http-nav-delay 100` | exactly 100ms between navigations |
| `adaptive` | none (the default) | 20ms, growing with load, cooling down when idle |

Each mode gets **two bursts** of navigations with an idle pause between them.
The pause is the point: it shows the cooldown. Adaptive mode forgives one unit
of pressure per 200ms of idle time, so after a long enough pause the second
burst starts as fast as the first one did.

## Environment

| variable | default | meaning |
|---|---|---|
| `WS_URL` | `ws://127.0.0.1:9222` | CDP endpoint. When this script starts the browsers, the host and the first port come from here; each mode gets the next port (9222, 9223, 9224). |
| `RUNS` | `100` | navigations per phase, so 200 per mode |
| `PAUSE_MS` | `15000` | idle time between the two phases |
| `LPD_PATH` | `../browser/zig-out/bin/lightpanda` | the binary to start |
| `TARGET_HOST` | `127.0.0.2` | address the browser uses to reach the server |
| `SPAWN` | `1` | set to `0` to skip starting browsers and run one pass against `WS_URL` |
| `OUT` | `rate-limit/results.json` | where the raw data is written |

To drive a browser you started yourself:

```sh
lightpanda serve --port 9222 &
SPAWN=0 node rate-limit/bench.js
```

## Why 127.0.0.2 and not 127.0.0.1

The rate limiter never throttles `localhost`, `127.0.0.1` or `[::1]`. It
protects remote hosts, not your own machine. So a test server on `127.0.0.1`
would show no limit at all.

`127.0.0.2` is still your machine, but the limiter does not recognise it as
loopback, so it gets throttled like any other host. On Linux the whole
`127.0.0.0/8` range is local and this works with no setup. On macOS, add the
alias once:

```sh
sudo ifconfig lo0 alias 127.0.0.2 up
```

Any other name that resolves to this machine works too: set `TARGET_HOST`.

## What you get

**A summary table** with, per mode and per phase: requests received, how long
they took, the request rate, and the spacing between requests (p50, p95, max)
from the server, next to the median `page.goto()` time from the client.

**Chart 1 — requests received over time**, all three modes on one plot. The
flat part in the middle of each line is the pause. A line that bends to the
right is slowing down.

**Chart 2 — spacing between requests**, one plot per mode, by request number.
This is where the rate limiter is visible directly. Adaptive draws a
staircase; the pause resets it.

**Chart 3 — `page.goto()` duration**, all three modes. The client waits inside
`goto()`: the limiter holds the request before it goes on the wire, so the
delay shows up as navigation time.

## Sample result

100 navigations per phase, 15s pause, on a debug build:

```
  mode      phase  reqs  span (s)  req/s  gap p50  gap p95  gap max  client p50
  --------  -----  ----  --------  -----  -------  -------  -------  ----------
  off           1   100      0.31  318.0      3.1      3.6      5.6         3.0
                2   100      0.32  314.3      3.1      3.7      5.6         3.0
  fixed100      1   100      9.90   10.0    100.0    100.7    101.0       100.1
                2   100      9.90   10.0    100.0    100.7    101.4        99.9
  adaptive      1   100      7.98   12.4     80.2    120.4    140.3        80.3
                2   100      7.98   12.4     80.5    120.5    139.8        80.5
```

And the adaptive staircase, with the cooldown in the middle:

```
           gap since previous request (ms)
      140 |                                    a                                    a
          |                                    :
          |                           aaaaaaaaaa                           aaaaaaaaaa
          |                                    :
     97.1 |                    aaaaaaaa        :                   aaaaaaaa
          |                                    :
          |              aaaaaa                :              aaaaaa
          |        aaaaaa                      :        aaaaaa
     53.9 |          a                         :           a
          |    aaaaa                           :    aaaaa
          |                                    :
          |aaaa                                :aaaa
     10.8 |                                    :
        0 |                                    :
          +--------------------------------------------------------------------------
           2               51.5                101               151              200
           request number   (":" = the 15000ms pause)

  end of phase 1: 140ms spacing
  start of phase 2 after 15000ms idle: 21ms spacing
```

Phase 2 repeats phase 1 exactly. 15s of idle time gave back all the pressure
the first burst had built up.

## Notes

- The page has no image, no script and no stylesheet, so one navigation is
  exactly one HTTP request. Only top-level navigations are rate limited
  anyway; subresources never are.
- Every URL carries a different query string and the server answers
  `Cache-Control: no-store`, so no navigation is served from the cache.
- Each mode warms up with one load of `http://127.0.0.1:PORT/warmup`. That
  address is exempt, so the first-load cost is paid without putting pressure
  on the measured host.
- Numbers from a debug build. A release build makes the `off` line much
  steeper; the two throttled modes do not move, because their spacing is wall
  clock, not work.
