#!/usr/bin/env bash
#
# Agent regression suite for `lightpanda agent`, driven by the browser repo's
# CI (e2e-test.yml agent-deterministic job + agent-regression.yml). Two layers:
#
#   deterministic  — replay golden PandaScripts against the existing demo
#                    sites in public/ (campfire-commerce, amiibo — both
#                    JS-rendered, served by the demo runner) and compare the
#                    returned JSON exactly to golden files. No API key, no
#                    external network.
#
#   live           — drive the real LLM agent (needs an API key):
#                      * static Q&A: ask closed-form questions about a local
#                        fixture page, substring-match the answer.
#                      * form save+replay: ask the agent to fill and submit a
#                        local form fixture and /save the script, then replay
#                        it token-free — the only e2e check that the Recorder
#                        emits interaction calls (fill/click), not just
#                        goto/extract.
#                      * HN save+replay: ask the agent to scrape live Hacker
#                        News and /save a reproducible script, then replay it
#                        token-free and validate the output against a shape
#                        invariant (jq), not exact values.
#
# Usage: agent/run.sh [deterministic|live|all|update-golden]  (default: all)
#
# update-golden regenerates every golden/<name>.json from the current sites
# and scripts — review the diff before committing.
#
# Env:
#   LPD_PATH       path to the lightpanda binary, same variable wptrunner uses
#                  (default: ../browser/zig-out/bin/lightpanda, the sibling
#                  workspace checkout; CI always sets it explicitly)
#   GOOGLE_API_KEY or GEMINI_API_KEY (the binary accepts both) — required for
#                  the live layer; live layer is skipped if neither is set
#   LP_MODEL       Gemini model id for the live layer (default below)
#   LP_HTTP_PROXY  optional proxy for the live HN call only (datacenter IPs are
#                  often blocked by news.ycombinator.com); localhost fixtures
#                  are never proxied
#   MAX_TOKENS     per-live-task total-token ceiling (default: 3000000).
#                  `total` counts cached reads, so a normal HN save is ~1M;
#                  this is a loose backstop against a runaway agent loop.
set -uo pipefail

LAYER="${1:-all}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO="$(cd "$HERE/.." && pwd)"
LPD="${LPD_PATH:-$DEMO/../browser/zig-out/bin/lightpanda}"
# Pin an explicit model id — never a *-latest / *-preview alias, which drift.
LP_MODEL="${LP_MODEL:-gemini-3.5-flash}"
MAX_TOKENS="${MAX_TOKENS:-3000000}"

export LIGHTPANDA_DISABLE_TELEMETRY=true

PASS=0
FAIL=0
green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
pass()  { green "PASS: $1"; PASS=$((PASS + 1)); }
fail()  { red   "FAIL: $1"; FAIL=$((FAIL + 1)); }
info()  { printf '\033[2m%s\033[0m\n' "$1"; }

[ -x "$LPD" ] || { red "lightpanda binary not found or not executable: $LPD"; exit 2; }

TMP="$(mktemp -d)"
SRV=""
cleanup() {
  [ -n "$SRV" ] && kill "$SRV" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

# The address is not configurable: the site URLs are pinned in scripts/*.js,
# the goldens, and cases/static-qa.tsv. An already-running server (e.g. a
# shared `runner -serve` in CI) is adopted instead of started — and then not
# killed on exit.
start_server() {
  local probe="http://127.0.0.1:1234/campfire-commerce/json/product.json"
  if curl -sf "$probe" -o /dev/null; then
    info "reusing fixture server already running on 127.0.0.1:1234"
    return 0
  fi
  # Build instead of `go run` so kill reaches the server process itself, not
  # a parent that may orphan it. Pass the address/dir flags so stray
  # RUNNER_HTTP_* env vars can't move the server away from the pinned URLs.
  ( cd "$DEMO/runner" && go build -o "$TMP/runner" . ) || { red "runner build failed"; exit 2; }
  "$TMP/runner" -serve -http-addr 127.0.0.1:1234 -http-dir "$DEMO/public" >/dev/null 2>&1 &
  SRV=$!
  for _ in $(seq 1 25); do
    curl -sf "$probe" -o /dev/null && return 0
    kill -0 "$SRV" 2>/dev/null || break
    sleep 0.2
  done
  red "fixture server failed to start on 127.0.0.1:1234"; exit 2
}

# --- deterministic layer -----------------------------------------------------
run_replay() {
  local name="$1"
  if ! "$LPD" agent "$HERE/scripts/$name.js" >"$TMP/out" 2>/dev/null; then
    fail "$name.js replay (non-zero exit)"; return
  fi
  if ! jq -e . "$TMP/out" >/dev/null 2>&1; then
    fail "$name.js replay (output is not valid JSON)"; return
  fi
  local d
  if d="$(diff <(jq -S . "$HERE/golden/$name.json") <(jq -S . "$TMP/out"))"; then
    pass "$name.js replay matches golden"
  else
    fail "$name.js replay differs from golden/$name.json"
    info "  diff (golden < , actual > ):"
    printf '%s\n' "$d" | sed 's/^/    /'
    info "  if public/ changed intentionally, regenerate with agent/run.sh update-golden; otherwise this is an extract/replay regression"
  fi
}

run_deterministic() {
  info "== deterministic layer (no API key) =="
  local s
  for s in "$HERE"/scripts/*.js; do
    run_replay "$(basename "$s" .js)"
  done
}

# An instant empty answer usually means an API error (bad key, quota) that
# only appears on stderr.
show_err() {
  sed -n '/^\$usage /!p' "$1" | tail -3 | sed 's/^/    /'
}

# The $usage stderr line is a stable key=value contract for wrappers; the
# ceiling is a backstop against runaway agent loops.
check_usage() {
  local errfile="$1" label="$2" total
  total="$(sed -n '/^\$usage /{s/.*total=\([0-9]\+\).*/\1/p;q}' "$errfile")"
  [ -n "$total" ] && info "  usage: total=${total} tokens ($label)"
  if [ -n "$total" ] && [ "$total" -gt "$MAX_TOKENS" ]; then
    fail "$label exceeded token ceiling ($total > $MAX_TOKENS)"
  fi
}

# --- live layer --------------------------------------------------------------
run_live_qa() {
  info "== live layer: static Q&A (model=$LP_MODEL) =="
  while IFS=$'\t' read -r task expected; do
    [ -z "${task// }" ] && continue
    case "$task" in \#*) continue ;; esac
    timeout 300 "$LPD" agent --provider gemini --model "$LP_MODEL" --task "$task" >"$TMP/out" 2>"$TMP/err"
    if grep -qiF "$expected" "$TMP/out"; then
      pass "Q&A: expected \"$expected\""
    else
      fail "Q&A: expected \"$expected\" not found in answer"
      info "  answer: $(tr '\n' ' ' <"$TMP/out" | cut -c1-200)"
      show_err "$TMP/err"
    fi
    check_usage "$TMP/err" "Q&A \"$expected\""
  done <"$HERE/cases/static-qa.tsv"
}

# Save + replay flow shared by the live cases: run the agent with the task
# from cases/<name>.task and --save, require every space-separated regex in
# <required-calls> to match the saved script, then replay it token-free and
# validate the output with cases/<name>.jq. Extra args go to the save run
# (e.g. --http-proxy).
run_live_save_replay() {
  local name="$1" save_timeout="$2" replay_timeout="$3" required="$4"
  shift 4
  local script="$TMP/$name.js" task
  task="$(cat "$HERE/cases/$name.task")"

  timeout "$save_timeout" "$LPD" agent --provider gemini --model "$LP_MODEL" "$@" --task "$task" --save "$script" >/dev/null 2>"$TMP/err"
  check_usage "$TMP/err" "$name save"

  if [ ! -s "$script" ]; then
    fail "$name save produced no script"
    show_err "$TMP/err"
    return
  fi
  local p missing=""
  for p in $required; do
    grep -qE "$p" "$script" || missing="$missing $p"
  done
  if [ -z "$missing" ]; then
    pass "$name saved script records the expected calls ($required)"
  else
    fail "$name saved script missing$missing — see below"
    sed 's/^/    /' "$script"
  fi

  # Replay without --task runs no LLM — no key or tokens needed.
  if ! timeout "$replay_timeout" "$LPD" agent "$script" >"$TMP/out" 2>/dev/null; then
    fail "$name saved script failed on replay"; return
  fi
  if jq -e -f "$HERE/cases/$name.jq" "$TMP/out" >/dev/null 2>&1; then
    pass "$name replay output satisfies cases/$name.jq"
  else
    fail "$name replay output violates cases/$name.jq"
    info "  output: $(tr '\n' ' ' <"$TMP/out" | cut -c1-300)"
  fi
}

run_live_hn() {
  info "== live layer: HN save + replay (model=$LP_MODEL) =="
  local proxy_args=()
  [ -n "${LP_HTTP_PROXY:-}" ] && proxy_args=(--http-proxy "$LP_HTTP_PROXY")
  run_live_save_replay hn-live 900 300 'goto\( extract\(' "${proxy_args[@]}"
}

run_live_form_save() {
  info "== live layer: form save + replay (model=$LP_MODEL) =="
  # The agent may submit via click or by pressing Enter — accept either.
  run_live_save_replay form-live 300 120 'fill\( click\(|press\('
}

# --- dispatch ----------------------------------------------------------------
start_server

case "$LAYER" in
  deterministic) run_deterministic ;;
  live)
    [ -n "${GOOGLE_API_KEY:-}${GEMINI_API_KEY:-}" ] || { red "GOOGLE_API_KEY/GEMINI_API_KEY unset — cannot run live layer"; exit 2; }
    run_live_qa; run_live_form_save; run_live_hn ;;
  all)
    run_deterministic
    if [ -n "${GOOGLE_API_KEY:-}${GEMINI_API_KEY:-}" ]; then
      run_live_qa; run_live_form_save; run_live_hn
    else
      info "GOOGLE_API_KEY/GEMINI_API_KEY unset — skipping live layer"
    fi ;;
  update-golden)
    for s in "$HERE"/scripts/*.js; do
      name="$(basename "$s" .js)"
      "$LPD" agent "$s" 2>/dev/null | jq -S . >"$HERE/golden/$name.json"
      info "golden/$name.json regenerated"
    done
    info "review the diff before committing"
    exit 0 ;;
  *) red "unknown layer: $LAYER (use deterministic|live|all|update-golden)"; exit 2 ;;
esac

echo
echo "-------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  green "SUMMARY: $PASS passed, 0 failed"
  exit 0
else
  red "SUMMARY: $PASS passed, $FAIL failed"
  exit 1
fi
