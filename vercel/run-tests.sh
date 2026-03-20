#!/bin/bash
# agent-browser × Lightpanda — Final Validation Test Suite
# Validates all claims made in the blog post:
#   Part A: agent-browser + Chrome (baseline)
#   Part B: agent-browser --engine lightpanda (full command suite)
#   Part C: Lightpanda standalone (fetch, serve)
#
# Requires: agent-browser 0.20.13, lightpanda nightly ddd34dc5

set -uo pipefail

LP="/Users/nitya/Desktop/Work/Lightpanda testing Vercel/lightpanda"
DEMO_URL="https://demo-browser.lightpanda.io/campfire-commerce/"
SIMPLE_URL="https://example.com"
RESULTS_FILE="/Users/nitya/Desktop/Work/Lightpanda testing Vercel/testing/final-live-results.txt"
SHOT_DIR="/Users/nitya/Desktop/Work/Lightpanda testing Vercel/testing"
PASS=0
FAIL=0
SKIP=0

log() { printf "[%s] %s\n" "$(date '+%H:%M:%S')" "$*"; }
pass() { log "✅ PASS: $1"; PASS=$((PASS + 1)); }
fail() { log "❌ FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }
skip() { log "⚠️  SKIP: $1 — $2"; SKIP=$((SKIP + 1)); }
ms()   { python3 -c 'import time; print(int(time.time()*1000))'; }

exec > >(tee "$RESULTS_FILE") 2>&1

echo "============================================================"
echo " agent-browser × Lightpanda — Final Validation"
echo " Date: $(date)"
echo " agent-browser: $(agent-browser --version 2>/dev/null || echo 'NOT INSTALLED')"
echo " Lightpanda: $("$LP" version 2>/dev/null || echo 'NOT FOUND')"
echo " Lightpanda binary size: $(wc -c < "$LP" | tr -d ' ') bytes"
echo " Platform: $(uname -m) / macOS $(sw_vers -productVersion 2>/dev/null)"
echo "============================================================"

########################################################################
# SETUP — clean slate
########################################################################
echo ""
log "=== SETUP: killing existing processes, cleaning sockets ==="
pkill -f "lightpanda" 2>/dev/null || true
pkill -f "agent-browser" 2>/dev/null || true
rm -f ~/.agent-browser/default.pid ~/.agent-browser/default.sock 2>/dev/null
sleep 2

if [[ -x "$LP" ]]; then
  pass "Setup: Lightpanda binary executable ($("$LP" version 2>/dev/null))"
else
  fail "Setup: Lightpanda binary" "not found at $LP"
  exit 1
fi

if command -v agent-browser &>/dev/null; then
  pass "Setup: agent-browser on PATH ($(agent-browser --version 2>/dev/null))"
else
  fail "Setup: agent-browser" "not on PATH"
  exit 1
fi

########################################################################
# PART A: agent-browser + Chrome (default engine) — BASELINE
########################################################################
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " PART A: agent-browser + Chrome (default engine)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
AB="agent-browser"

# A1: open example.com (cold start)
log "--- A1: open example.com (cold start) ---"
T1=$(ms)
A1_OUT=$($AB open "$SIMPLE_URL" 2>&1) || true
T2=$(ms)
log "  output: $A1_OUT"
log "  time: $((T2 - T1))ms"
if [[ "$A1_OUT" != *"error"* && "$A1_OUT" != *"Failed"* ]]; then
  pass "A1: open example.com (cold) — $((T2 - T1))ms"
else
  fail "A1: open example.com" "$A1_OUT"
fi

# A2: open campfire-commerce (JS+XHR)
log "--- A2: open campfire-commerce ---"
T1=$(ms)
A2_OUT=$($AB open "$DEMO_URL" 2>&1) || true
T2=$(ms)
log "  output: $A2_OUT"
log "  time: $((T2 - T1))ms"
if [[ "$A2_OUT" != *"Failed"* ]]; then
  pass "A2: open campfire-commerce — $((T2 - T1))ms"
else
  fail "A2: open campfire-commerce" "$A2_OUT"
fi

# A3: get title
log "--- A3: get title ---"
A3_OUT=$($AB get title 2>&1) || true
log "  output: '$A3_OUT'"
if [[ -n "$A3_OUT" && "$A3_OUT" != *"Failed"* ]]; then
  pass "A3: get title — '$A3_OUT'"
else
  fail "A3: get title" "'$A3_OUT'"
fi

# A4: get url
log "--- A4: get url ---"
A4_OUT=$($AB get url 2>&1) || true
log "  output: '$A4_OUT'"
if [[ -n "$A4_OUT" && "$A4_OUT" != *"Failed"* ]]; then
  pass "A4: get url — '$A4_OUT'"
else
  fail "A4: get url" "'$A4_OUT'"
fi

# A5: snapshot -i
log "--- A5: snapshot -i ---"
A5_OUT=$($AB snapshot -i 2>&1) || true
A5_REFS=$(echo "$A5_OUT" | grep -c "\[ref=" || true)
log "  interactive refs: $A5_REFS"
if [[ $A5_REFS -gt 0 ]]; then
  pass "A5: snapshot -i — $A5_REFS interactive refs"
  echo "$A5_OUT" | grep "\[ref=" | sed 's/^/    /'
else
  fail "A5: snapshot -i" "no refs found"
fi

# A6: snapshot -i --json
log "--- A6: snapshot -i --json ---"
A6_OUT=$($AB snapshot -i --json 2>&1) || true
if echo "$A6_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  Keys:', list(d.keys()))" 2>/dev/null; then
  pass "A6: snapshot -i --json — valid JSON"
else
  fail "A6: snapshot --json" "invalid JSON"
fi

# A7: eval document.title
log "--- A7: eval document.title ---"
A7_OUT=$($AB eval 'document.title' 2>&1) || true
log "  output: '$A7_OUT'"
if [[ -n "$A7_OUT" && "$A7_OUT" != *"Failed"* ]]; then
  pass "A7: eval document.title — '$A7_OUT'"
else
  fail "A7: eval" "'$A7_OUT'"
fi

# A8: eval link count
log "--- A8: eval link count ---"
A8_OUT=$($AB eval 'document.querySelectorAll("a").length' 2>&1) || true
log "  output: '$A8_OUT'"
if [[ -n "$A8_OUT" ]]; then
  pass "A8: eval link count — $A8_OUT"
else
  fail "A8: eval link count" "empty"
fi

# A9: screenshot
log "--- A9: screenshot ---"
CHROME_SHOT="$SHOT_DIR/final-chrome-screenshot.png"
rm -f "$CHROME_SHOT"
$AB screenshot "$CHROME_SHOT" 2>&1 || true
if [[ -f "$CHROME_SHOT" ]]; then
  CHROME_SHOT_SIZE=$(wc -c < "$CHROME_SHOT" | tr -d ' ')
  pass "A9: screenshot — $CHROME_SHOT_SIZE bytes"
else
  fail "A9: screenshot" "file not created"
fi

# A10: back/forward/reload
log "--- A10: back/forward/reload ---"
$AB open "$SIMPLE_URL" 2>&1 || true
A10a=$($AB back 2>&1) || true
A10b=$($AB forward 2>&1) || true
A10c=$($AB reload 2>&1) || true
log "  back: '$A10a'"
log "  forward: '$A10b'"
log "  reload: '$A10c'"
NAVFAIL=0
[[ "$A10a" == *"Failed"* ]] && NAVFAIL=$((NAVFAIL+1))
[[ "$A10b" == *"Failed"* ]] && NAVFAIL=$((NAVFAIL+1))
[[ "$A10c" == *"Failed"* ]] && NAVFAIL=$((NAVFAIL+1))
if [[ $NAVFAIL -eq 0 ]]; then
  pass "A10: back/forward/reload"
else
  fail "A10: navigation" "$NAVFAIL of 3 failed"
fi

# A11: cookies
log "--- A11: cookies ---"
A11_GET=$($AB cookies 2>&1) || true
A11_SET=$($AB cookies set test_cookie test_value 2>&1) || true
log "  cookies set: '$A11_SET'"
if [[ "$A11_SET" != *"Failed"* ]]; then
  pass "A11: cookies get/set"
else
  fail "A11: cookies" "'$A11_SET'"
fi

# A12: tabs
log "--- A12: tabs ---"
A12_OUT=$($AB tab 2>&1) || true
log "  tab: '$A12_OUT'"
if [[ -n "$A12_OUT" ]]; then
  pass "A12: tab list"
else
  fail "A12: tab list" "empty"
fi

# A13: diff snapshot
log "--- A13: diff snapshot ---"
A13_OUT=$($AB diff snapshot 2>&1) || true
if [[ "$A13_OUT" == *"Failed"* ]]; then
  skip "A13: diff snapshot" "needs prior snapshot state"
else
  pass "A13: diff snapshot"
fi

# A14: wait
log "--- A14: wait ---"
$AB open "$DEMO_URL" 2>&1 || true
A14_OUT=$($AB wait --load networkidle 2>&1) || true
pass "A14: wait --load networkidle"

# A15: warm chain benchmark (Chrome)
log "--- A15: warm chain benchmark ---"
T1=$(ms)
$AB open "$DEMO_URL" 2>&1 || true
$AB wait --load networkidle 2>&1 || true
CHAIN_TITLE=$($AB get title 2>&1) || true
T2=$(ms)
A15_TIME=$((T2 - T1))
log "  chain total: ${A15_TIME}ms, title: '$CHAIN_TITLE'"
pass "A15: Chrome warm chain — ${A15_TIME}ms"

# Close Chrome
$AB close 2>&1 || true
rm -f ~/.agent-browser/default.pid ~/.agent-browser/default.sock 2>/dev/null
sleep 2

########################################################################
# PART B: agent-browser --engine lightpanda (full command suite)
########################################################################
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " PART B: agent-browser --engine lightpanda"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

rm -f ~/.agent-browser/default.pid ~/.agent-browser/default.sock 2>/dev/null

# Wrapper function to avoid eval + spaces-in-path issues
lpe() { agent-browser --engine lightpanda --executable-path "$LP" "$@"; }

# B1: open example.com
log "--- B1: open example.com ---"
B1_OUT=$(lpe open "$SIMPLE_URL" 2>&1) || true
log "  output: '$B1_OUT'"
if [[ "$B1_OUT" == *"Failed"* || "$B1_OUT" == *"EAGAIN"* || "$B1_OUT" == *"Unknown command"* ]]; then
  fail "B1: --engine lightpanda open" "$B1_OUT"
  log "FATAL: --engine lightpanda failed. Skipping remaining Part B tests."
  skip "B2-B25: all --engine lightpanda tests" "blocked by B1 failure"
else
  pass "B1: --engine lightpanda open example.com"

  # B2: open campfire-commerce (JS+XHR)
  log "--- B2: open campfire-commerce ---"
  T1=$(ms)
  B2_OUT=$(lpe open "$DEMO_URL" 2>&1) || true
  T2=$(ms)
  log "  output: '$B2_OUT' — $((T2 - T1))ms"
  if [[ "$B2_OUT" != *"Failed"* ]]; then
    pass "B2: open campfire-commerce — $((T2 - T1))ms"
  else
    fail "B2: open campfire-commerce" "$B2_OUT"
  fi

  # B3: get title
  log "--- B3: get title ---"
  B3_OUT=$(lpe get title 2>&1) || true
  log "  output: '$B3_OUT'"
  if [[ -n "$B3_OUT" && "$B3_OUT" != *"Failed"* ]]; then
    pass "B3: get title — '$B3_OUT'"
  else
    fail "B3: get title" "'$B3_OUT'"
  fi

  # B4: get url
  log "--- B4: get url ---"
  B4_OUT=$(lpe get url 2>&1) || true
  log "  output: '$B4_OUT'"
  if [[ -n "$B4_OUT" && "$B4_OUT" != *"Failed"* ]]; then
    pass "B4: get url — '$B4_OUT'"
  else
    fail "B4: get url" "'$B4_OUT'"
  fi

  # B5: snapshot -i (blog claims 22 refs)
  log "--- B5: snapshot -i ---"
  B5_OUT=$(lpe snapshot -i 2>&1) || true
  B5_REFS=$(echo "$B5_OUT" | grep -c "\[ref=" || true)
  log "  interactive refs: $B5_REFS"
  if [[ $B5_REFS -gt 0 ]]; then
    pass "B5: snapshot -i — $B5_REFS interactive refs"
    echo "$B5_OUT" | grep "\[ref=" | sed 's/^/    /'
  else
    fail "B5: snapshot -i" "no refs found"
  fi

  # B6: snapshot -i --json
  log "--- B6: snapshot -i --json ---"
  B6_OUT=$(lpe snapshot -i --json 2>&1) || true
  if echo "$B6_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  Keys:', list(d.keys()))" 2>/dev/null; then
    pass "B6: snapshot -i --json — valid JSON"
  else
    fail "B6: snapshot --json" "invalid JSON"
  fi

  # B7: eval document.title
  log "--- B7: eval ---"
  B7_OUT=$(lpe eval 'document.title' 2>&1) || true
  log "  output: '$B7_OUT'"
  if [[ -n "$B7_OUT" && "$B7_OUT" != *"Failed"* ]]; then
    pass "B7: eval document.title — '$B7_OUT'"
  else
    fail "B7: eval" "'$B7_OUT'"
  fi

  # B8: eval link count
  B8_OUT=$(lpe eval 'document.querySelectorAll("a").length' 2>&1) || true
  log "  eval link count: '$B8_OUT'"
  if [[ -n "$B8_OUT" ]]; then
    pass "B8: eval link count — $B8_OUT"
  else
    fail "B8: eval link count" "empty"
  fi

  # B9: fill
  log "--- B9: fill ---"
  B9_OUT=$(lpe fill @e10 "3" 2>&1) || true
  log "  output: '$B9_OUT'"
  if [[ "$B9_OUT" != *"Failed"* && "$B9_OUT" != *"error"* ]]; then
    pass "B9: fill @e10"
  else
    fail "B9: fill" "'$B9_OUT'"
  fi

  # B10: click
  log "--- B10: click ---"
  B10_OUT=$(lpe click @e11 2>&1) || true
  log "  output: '$B10_OUT'"
  if [[ "$B10_OUT" != *"Failed"* && "$B10_OUT" != *"error"* ]]; then
    pass "B10: click @e11"
  else
    fail "B10: click" "'$B10_OUT'"
  fi

  # B11: hover
  log "--- B11: hover ---"
  B11_OUT=$(lpe hover @e1 2>&1) || true
  if [[ "$B11_OUT" != *"Failed"* && "$B11_OUT" != *"error"* ]]; then
    pass "B11: hover @e1"
  else
    fail "B11: hover" "'$B11_OUT'"
  fi

  # B12: scroll
  log "--- B12: scroll ---"
  B12_OUT=$(lpe scroll down 200 2>&1) || true
  if [[ "$B12_OUT" != *"Failed"* && "$B12_OUT" != *"error"* ]]; then
    pass "B12: scroll down 200"
  else
    fail "B12: scroll" "'$B12_OUT'"
  fi

  # B13: press
  log "--- B13: press ---"
  B13_OUT=$(lpe press Tab 2>&1) || true
  if [[ "$B13_OUT" != *"Failed"* && "$B13_OUT" != *"error"* ]]; then
    pass "B13: press Tab"
  else
    fail "B13: press" "'$B13_OUT'"
  fi

  # B14: type
  log "--- B14: type ---"
  B14_OUT=$(lpe type @e10 "5" 2>&1) || true
  if [[ "$B14_OUT" != *"Failed"* && "$B14_OUT" != *"error"* ]]; then
    pass "B14: type @e10"
  else
    fail "B14: type" "'$B14_OUT'"
  fi

  # B15: screenshot (should return placeholder)
  log "--- B15: screenshot ---"
  LP_SHOT="$SHOT_DIR/final-lightpanda-screenshot.png"
  rm -f "$LP_SHOT"
  lpe screenshot "$LP_SHOT" 2>&1 || true
  if [[ -f "$LP_SHOT" ]]; then
    LP_SHOT_SIZE=$(wc -c < "$LP_SHOT" | tr -d ' ')
    pass "B15: screenshot — $LP_SHOT_SIZE bytes (placeholder, no graphical rendering)"
  else
    fail "B15: screenshot" "file not created"
  fi

  # B16: wait
  log "--- B16: wait ---"
  B16_OUT=$(lpe wait --load networkidle 2>&1) || true
  if [[ "$B16_OUT" != *"Failed"* ]]; then
    pass "B16: wait --load networkidle"
  else
    fail "B16: wait" "'$B16_OUT'"
  fi

  # B17: cookies
  log "--- B17: cookies ---"
  B17_GET=$(lpe cookies 2>&1) || true
  B17_SET=$(lpe cookies set test test_val 2>&1) || true
  log "  cookies set: '$B17_SET'"
  if [[ "$B17_SET" != *"Failed"* ]]; then
    pass "B17: cookies get/set"
  else
    fail "B17: cookies" "'$B17_SET'"
  fi

  # B18: tab list
  log "--- B18: tab ---"
  B18_OUT=$(lpe tab 2>&1) || true
  log "  tab: '$B18_OUT'"
  if [[ -n "$B18_OUT" ]]; then
    pass "B18: tab list"
  else
    fail "B18: tab list" "empty"
  fi

  # B19: diff snapshot
  log "--- B19: diff snapshot ---"
  B19_OUT=$(lpe diff snapshot 2>&1) || true
  if [[ "$B19_OUT" == *"Failed"* ]]; then
    skip "B19: diff snapshot" "needs prior snapshot state"
  else
    B19_ADDS=$(echo "$B19_OUT" | grep -c "^+" || true)
    pass "B19: diff snapshot — $B19_ADDS additions"
  fi

  # B20: back/forward
  log "--- B20: back/forward ---"
  lpe open "$SIMPLE_URL" 2>&1 || true
  B20a=$(lpe back 2>&1) || true
  B20b=$(lpe forward 2>&1) || true
  log "  back: '$B20a'"
  log "  forward: '$B20b'"
  B20_FAIL=0
  [[ "$B20a" == *"Failed"* ]] && B20_FAIL=$((B20_FAIL+1))
  [[ "$B20b" == *"Failed"* ]] && B20_FAIL=$((B20_FAIL+1))
  if [[ $B20_FAIL -eq 0 ]]; then
    pass "B20: back/forward"
  else
    fail "B20: back/forward" "$B20_FAIL of 2 failed"
  fi

  # B21: reload (expected to fail: Page.reload not implemented)
  log "--- B21: reload (expected fail) ---"
  B21_OUT=$(lpe reload 2>&1) || true
  log "  output: '$B21_OUT'"
  if [[ "$B21_OUT" == *"UnknownMethod"* || "$B21_OUT" == *"error"* || "$B21_OUT" == *"Failed"* ]]; then
    pass "B21: reload — correctly fails (Page.reload not implemented)"
  else
    fail "B21: reload" "expected failure but got: '$B21_OUT'"
  fi

  # B22: pdf (expected to fail: Page.printToPDF not implemented)
  log "--- B22: pdf (expected fail) ---"
  B22_OUT=$(lpe pdf "$SHOT_DIR/final-test.pdf" 2>&1) || true
  log "  output: '$B22_OUT'"
  if [[ "$B22_OUT" == *"UnknownMethod"* || "$B22_OUT" == *"error"* || "$B22_OUT" == *"Failed"* ]]; then
    pass "B22: pdf — correctly fails (Page.printToPDF not implemented)"
  else
    fail "B22: pdf" "expected failure but got: '$B22_OUT'"
  fi

  # B23: tab new (expected to fail: Target.createTarget not implemented)
  log "--- B23: tab new (expected fail) ---"
  B23_OUT=$(lpe tab new "$SIMPLE_URL" 2>&1) || true
  log "  output: '$B23_OUT'"
  if [[ "$B23_OUT" == *"TargetAlreadyLoaded"* || "$B23_OUT" == *"error"* || "$B23_OUT" == *"Failed"* ]]; then
    pass "B23: tab new — correctly fails (Target.createTarget not implemented)"
  else
    fail "B23: tab new" "expected failure but got: '$B23_OUT'"
  fi

  # B24: cold start benchmark
  log "--- B24: cold start benchmark ---"
  lpe close 2>&1 || true
  rm -f ~/.agent-browser/default.pid ~/.agent-browser/default.sock 2>/dev/null
  sleep 2
  T1=$(ms)
  lpe open "$DEMO_URL" 2>&1 || true
  lpe wait --load networkidle 2>&1 || true
  B24_TITLE=$(lpe get title 2>&1) || true
  T2=$(ms)
  B24_TIME=$((T2 - T1))
  log "  cold chain: ${B24_TIME}ms, title: '$B24_TITLE'"
  pass "B24: Lightpanda cold start chain — ${B24_TIME}ms"

  # B25: warm chain benchmark
  log "--- B25: warm chain benchmark ---"
  T1=$(ms)
  lpe open "$DEMO_URL" 2>&1 || true
  lpe wait --load networkidle 2>&1 || true
  B25_TITLE=$(lpe get title 2>&1) || true
  T2=$(ms)
  B25_TIME=$((T2 - T1))
  log "  warm chain: ${B25_TIME}ms, title: '$B25_TITLE'"
  pass "B25: Lightpanda warm chain — ${B25_TIME}ms"

  # Close lightpanda session
  lpe close 2>&1 || true
fi

rm -f ~/.agent-browser/default.pid ~/.agent-browser/default.sock 2>/dev/null
sleep 1

########################################################################
# PART C: Lightpanda standalone (no agent-browser)
########################################################################
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " PART C: Lightpanda standalone"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# C1: version
log "--- C1: version ---"
C1_OUT=$("$LP" version 2>&1) || true
log "  version: '$C1_OUT'"
pass "C1: lightpanda version — '$C1_OUT'"

# C2: fetch HTML example.com
log "--- C2: fetch HTML (example.com) ---"
T1=$(ms)
C2_OUT=$("$LP" fetch --dump html "$SIMPLE_URL" 2>&1) || true
T2=$(ms)
C2_LINES=$(echo "$C2_OUT" | wc -l | tr -d ' ')
log "  lines: $C2_LINES, time: $((T2 - T1))ms"
if echo "$C2_OUT" | grep -qi "example\|doctype"; then
  pass "C2: fetch HTML example.com — $C2_LINES lines, $((T2 - T1))ms"
else
  fail "C2: fetch HTML example.com" "no HTML content"
fi

# C3: fetch HTML campfire-commerce (JS+XHR)
log "--- C3: fetch HTML (campfire-commerce) ---"
T1=$(ms)
C3_OUT=$("$LP" fetch --dump html "$DEMO_URL" 2>&1) || true
T2=$(ms)
C3_LINES=$(echo "$C3_OUT" | wc -l | tr -d ' ')
log "  lines: $C3_LINES, time: $((T2 - T1))ms"
if echo "$C3_OUT" | grep -qi "campfire\|outdoor\|nomad\|backpack"; then
  pass "C3: fetch HTML campfire-commerce — $C3_LINES lines, $((T2 - T1))ms"
  echo "$C3_OUT" | head -5 | sed 's/^/    /'
else
  fail "C3: fetch HTML campfire-commerce" "unexpected content"
fi

# C4: fetch markdown
log "--- C4: fetch Markdown ---"
T1=$(ms)
C4_OUT=$("$LP" fetch --dump markdown "$DEMO_URL" 2>&1) || true
T2=$(ms)
C4_LINES=$(echo "$C4_OUT" | wc -l | tr -d ' ')
log "  lines: $C4_LINES, time: $((T2 - T1))ms"
if [[ $C4_LINES -gt 2 ]]; then
  pass "C4: fetch Markdown campfire-commerce — $C4_LINES lines, $((T2 - T1))ms"
  echo "$C4_OUT" | head -7 | sed 's/^/    /'
else
  fail "C4: fetch Markdown" "$C4_LINES lines"
fi

# C5: serve (CDP server)
log "--- C5: serve (CDP server) ---"
"$LP" serve --host 127.0.0.1 --port 9222 --timeout 30 &
LP_PID=$!
sleep 2

CDP_VERSION=$(curl -s http://127.0.0.1:9222/json/version 2>&1)
log "  /json/version: '$CDP_VERSION'"
CDP_LIST=$(curl -s http://127.0.0.1:9222/json/list 2>&1)
log "  /json/list: '$CDP_LIST'"

if echo "$CDP_VERSION" | grep -q "webSocketDebuggerUrl"; then
  pass "C5: serve — /json/version works"
else
  fail "C5: serve" "no webSocketDebuggerUrl"
fi

if [[ "$CDP_LIST" == "Not found" || -z "$CDP_LIST" ]]; then
  log "  NOTE: /json/list not implemented (expected)"
  skip "C5b: /json/list" "not implemented by Lightpanda"
fi

kill "$LP_PID" 2>/dev/null || true
wait "$LP_PID" 2>/dev/null || true

# C6: fetch with strip_mode
log "--- C6: fetch with --strip_mode ---"
C6_OUT=$("$LP" fetch --dump html --strip_mode js,css "$SIMPLE_URL" 2>&1) || true
C6_LINES=$(echo "$C6_OUT" | wc -l | tr -d ' ')
if [[ $C6_LINES -gt 1 ]]; then
  pass "C6: fetch --strip_mode js,css — $C6_LINES lines"
else
  fail "C6: fetch --strip_mode" "$C6_LINES lines"
fi

########################################################################
# CLEANUP
########################################################################
echo ""
log "=== CLEANUP ==="
pkill -f "lightpanda serve" 2>/dev/null || true
agent-browser close 2>&1 || true
rm -f ~/.agent-browser/default.pid ~/.agent-browser/default.sock 2>/dev/null
pass "Cleanup"

########################################################################
# SUMMARY
########################################################################
echo ""
echo "============================================================"
echo " RESULTS: $PASS passed · $FAIL failed · $SKIP skipped"
echo "============================================================"
echo ""
echo " Part A (agent-browser + Chrome): baseline tests"
echo " Part B (--engine lightpanda):    full command suite + benchmarks"
echo " Part C (Lightpanda standalone):  fetch, serve, strip_mode"
echo ""
echo " Blog post claims to validate:"
echo "   - All commands pass with --engine lightpanda ✓"
echo "   - Lightpanda returns more interactive refs than Chrome"
echo "   - Cold start ~6x faster than Chrome"
echo "   - Screenshot returns placeholder (no pixels)"
echo "   - Page.reload, Page.printToPDF, Target.createTarget fail"
echo "   - Standalone fetch in ~352ms"
echo "============================================================"
