# Agent regression suite

End-to-end regression tests for `lightpanda agent`, running against the demo
sites that already live in `public/`. One fixture exists for this suite
specifically (`public/form/checkbox.html` — nothing else in `public/` has a
checkable input for `setChecked` to target); everything else is shared. The **browser
repo's CI** checks demo out and drives this suite, the same way the
runner/integration/wpt suites work. Two layers, so the cheap deterministic
checks can gate every browser PR while the expensive keyed checks run
nightly / on demand.

```
agent/
  run.sh                 orchestrator (bash + jq + the demo runner server)
  scripts/campfire.js    golden PandaScript: campfire-commerce product page
  scripts/amiibo.js      golden PandaScript: amiibo front page -> item crawl
  scripts/form.js        golden PandaScript: fill/selectOption/click + submit echo
  scripts/checked.js     golden PandaScript: setChecked on checkbox/radio + event order
  scripts/magic8ball.js  golden PandaScript: iframe + postMessage + Web Worker
  scripts/redirects.js   golden PandaScript: 3-hop location-write redirect chain
  scripts/cookies.js     golden PandaScript: cookie jar via fetch/XHR/302
  scripts/dynamic.js     golden PandaScript: injected <script> + cross-frame read
  golden/<name>.json     exact expected replay output per script
  cases/static-qa.tsv    <task>\t<expected-substring> per line
  cases/form-live.task   task prompt for the local form save+replay case
  cases/form-live.jq     invariant verifying that contract (pinned values)
  cases/hn-live.task     task prompt for the live HN case (pins the contract)
  cases/hn-live.jq       shape invariant verifying that contract
```

The target sites (`public/campfire-commerce/`, `public/amiibo/`) are
**JS-rendered shells** — scripts fetch JSON and fill the DOM — so the
deterministic layer exercises script execution, `fetch`, and DOM manipulation
on top of navigation and extraction. Both are fully deterministic (fixed JSON
data). They are served by the existing demo runner (`runner/main.go -serve`,
`public/` on `127.0.0.1:1234`), which run.sh builds and starts itself.

## Layers

### Deterministic (no API key, gates every browser PR)

Replays every script in `scripts/` and diffs the returned JSON **exactly**
against its `golden/<name>.json`:

- `campfire.js` — single-page extract of the product name, price, features,
  related products, and reviews (waits on the two async renders).
- `amiibo.js` — front page → item pages crawl via the "See also" links, the
  same shape as the live Hacker News case.
- `form.js` — fill/selectOption/click against `public/form/`, submitting to
  the runner's `/form/submit` echo: GET query encoding, hidden-field
  inclusion, disabled-field exclusion, and submitter-button semantics on a
  POST body.
- `checked.js` — `setChecked` against `public/form/checkbox.html`: unchecking
  a pre-checked box drops it from the submission, checking adds it, picking a
  radio replaces the group's value, and a listener-recorded field pins the
  click → input → change dispatch order (each fired exactly once).
- `magic8ball.js` — fill + click, then the answer travels window → iframe
  (postMessage) → Web Worker → back; `waitForScript` synchronizes and the
  script normalizes the random answer into a membership check.
- `redirects.js` — `public/location_write/` chain (`location.assign`,
  `document.location =`, `top.location =`); replay must settle on the final
  document.
- `cookies.js` — cookies set by a plain response and by a 302, then read back
  through `fetch` and `XMLHttpRequest` via the runner's `/cookies/get` echo.
- `dynamic.js` — a `<script>` element appended at runtime must load before
  extraction; plus a cross-frame DOM read (`public/frames/`).

### Live (needs `GOOGLE_API_KEY` or `GEMINI_API_KEY`, nightly / on demand)

Drives the real Gemini-backed agent:

- **Static Q&A** — for each row in `cases/static-qa.tsv`, run
  `lightpanda agent --task "<question about a public/ fixture>"` and assert
  the expected substring appears in the answer. Closed-form answers make the
  substring match robust to LLM phrasing. Rows include interaction-forcing
  tasks (fill + submit a form and report the echoed query) so the live agent
  is exercised beyond read/extract.
- **Form save + replay** — ask the agent (task in `cases/form-live.task`) to
  fill and submit the local form fixture and `/save` the script, then replay
  it token-free and validate against `cases/form-live.jq`. The fixture is
  deterministic, so the invariant pins actual values, and the saved script is
  checked for recorded interaction calls (`fill` + `click`/`press`) — the only
  e2e coverage that the Recorder captures interactions. Runs whenever a key is
  present; no proxy or external network needed.
- **HN save + replay** — ask the agent (task in `cases/hn-live.task`) to
  scrape live Hacker News and `/save` a reproducible script, then replay that
  script **token-free** and validate the output against `cases/hn-live.jq`
  (a *shape* invariant: exactly 5 stories, non-empty titles, ≤3 comments each
  with non-empty `user`/`text`, and at least one story with a comment). We
  can't assert exact values because the live site and the LLM both vary — so
  the task prompt pins the output contract and the schema verifies it; edit
  those two files together.

The stable `$usage total=N` line lightpanda prints to stderr is captured per
task; a loose `MAX_TOKENS` ceiling flags a runaway agent loop.

## Running locally

Assumes the sibling workspace layout (`../browser` next to this repo), or set
`LPD_PATH` to any lightpanda binary (same variable wptrunner uses). Needs Go,
`jq`, `curl`.

```bash
./agent/run.sh                    # all layers (live skipped if no key)
./agent/run.sh deterministic
GEMINI_API_KEY=... ./agent/run.sh live

# from the browser repo:
make test-agent                   # wraps this script, builds lightpanda if needed
```

Environment knobs (see the header of `run.sh`): `LPD_PATH`, `LP_MODEL`,
`LP_HTTP_PROXY`, `MAX_TOKENS`.

## CI

Driven by the browser repo's CI, which checks this repo out and runs
`agent/run.sh` — deterministic layer on every browser PR, all layers nightly /
on demand. See that repo's workflows for the wiring; the contract is: pass the
binary via `LPD_PATH`, a Gemini key via `GEMINI_API_KEY` for the live layer,
and optionally a residential proxy via `LP_HTTP_PROXY` for the live HN call
(datacenter IPs are often blocked by news.ycombinator.com).

## Maintenance

- **Add a deterministic case:** drop a `scripts/<name>.js` that returns a
  value, then `./agent/run.sh update-golden` — every script in `scripts/` is
  replayed and diffed automatically.
- **Add a Q&A case:** append a `<task>\t<expected>` row to
  `cases/static-qa.tsv` (point the task at any `public/` page with a
  closed-form answer; avoid bare small numbers as expected substrings —
  too weak as substring matches).
- **Shared fixtures:** the goldens pin content of `public/campfire-commerce/`
  and `public/amiibo/`. If those sites change for another suite, regenerate
  with `./agent/run.sh update-golden` and review the diff — the golden is the
  contract.
- **Coupling note:** browser CI pins demo@main. A browser change that alters
  extract/replay behavior needs a lockstep PR here to update the goldens.
