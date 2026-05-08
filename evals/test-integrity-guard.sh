#!/usr/bin/env bash
# Verifies PUA Integrity Guard anti-cheating decisions without Claude CLI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$PLUGIN_DIR/hooks/integrity-guard.sh"

PASS=0
FAIL=0
record_pass() { echo "  ✅ PASS: $1"; PASS=$((PASS+1)); }
record_fail() { echo "  ❌ FAIL: $1"; FAIL=$((FAIL+1)); }

json_input() {
  local tool="$1"
  local payload="$2"
  python3 - "$tool" "$payload" <<'PY'
import json, sys
print(json.dumps({
  "hook_event_name": "PreToolUse",
  "session_id": "test-session",
  "transcript_path": "/nonexistent/transcript.jsonl",
  "cwd": "/tmp/pua-integrity-test",
  "tool_name": sys.argv[1],
  "tool_input": json.loads(sys.argv[2]),
}, separators=(",", ":")))
PY
}

run_guard() {
  local force="$1"
  local tool="$2"
  local payload="$3"
  if [ "$force" = "force" ]; then
    PUA_INTEGRITY_FORCE=1 PUA_CONFIG=/nonexistent/pua-config.json bash "$HOOK" <<<"$(json_input "$tool" "$payload")"
  else
    PUA_CONFIG=/nonexistent/pua-config.json bash "$HOOK" <<<"$(json_input "$tool" "$payload")"
  fi
}

assert_decision() {
  local name="$1"
  local output="$2"
  local expected="$3"
  local contains="$4"
  if python3 - "$output" "$expected" "$contains" <<'PY'
import json, sys
out, expected, contains = sys.argv[1:]
try:
    data = json.loads(out)
except Exception as exc:
    print(f"invalid json: {exc}; output={out!r}")
    sys.exit(1)
specific = data.get('hookSpecificOutput', {})
actual = specific.get('permissionDecision')
reason = specific.get('permissionDecisionReason', '')
if actual != expected:
    print(f"decision mismatch: expected={expected} actual={actual} reason={reason}")
    sys.exit(1)
if contains not in reason:
    print(f"reason missing {contains!r}: {reason}")
    sys.exit(1)
PY
  then
    record_pass "$name"
  else
    record_fail "$name"
  fi
}

assert_empty() {
  local name="$1"
  local output="$2"
  if [ -z "$output" ]; then record_pass "$name"; else record_fail "$name"; printf '%s\n' "$output"; fi
}

echo "=== PUA Integrity Guard Tests ==="

OUT=$(run_guard inactive Write '{"file_path":"/repo/tests/auth.test.ts","content":"skip"}')
assert_empty "inactive guard stays silent" "$OUT"

OUT=$(run_guard force Write '{"file_path":"/repo/tests/auth.test.ts","content":"skip"}')
assert_decision "protected test write asks approval" "$OUT" "ask" "Grader gaming risk"

OUT=$(run_guard force Write '{"file_path":"/repo/src/auth.ts","content":"code"}')
assert_empty "ordinary source write allowed" "$OUT"

OUT=$(run_guard force Bash '{"command":"sed -i \"\" \"s/pass/skip/\" tests/auth.test.ts"}')
assert_decision "mutating bash on tests asks approval" "$OUT" "ask" "Grader gaming risk"

OUT=$(run_guard force Bash '{"command":"cat tests/auth.test.ts"}')
assert_empty "read-only bash on public tests allowed" "$OUT"

OUT=$(run_guard force Read '{"file_path":"/repo/verifier_private/hidden_tests/case.json"}')
assert_decision "hidden verifier read denied" "$OUT" "deny" "Solution contamination risk"

OUT=$(run_guard force Bash '{"command":"cat hidden_tests/case.json"}')
assert_decision "relative hidden-test bash read denied" "$OUT" "deny" "Solution contamination risk"

OUT=$(run_guard force Bash '{"command":"python3 -c '"'"'open(\"tests/fixtures.json\",\"w\").write(\"{}\")'"'"'"}')
assert_decision "mutating bash on tests directory asks approval" "$OUT" "ask" "Grader gaming risk"

OUT=$(run_guard force Glob '{"pattern":"**/hidden_tests/**","path":"/repo"}')
assert_decision "glob hidden tests denied" "$OUT" "deny" "Solution contamination risk"

OUT=$(run_guard force Grep '{"pattern":"token","path":"/repo","glob":"**/hidden_solution/*.json"}')
assert_decision "grep hidden solution glob denied" "$OUT" "deny" "Solution contamination risk"

OUT=$(run_guard force WebSearch '{"query":"SWE-bench official solution gold patch for task"}')
assert_decision "benchmark answer search asks approval" "$OUT" "ask" "Solution contamination risk"

OUT=$(run_guard force Write '{"file_path":"/repo/e2e/login.ts","content":"skip"}')
assert_decision "e2e test write asks approval" "$OUT" "ask" "Grader gaming risk"

OUT=$(run_guard force Read '{"file_path":"/repo/.env.local"}')
assert_decision "secret env read asks approval" "$OUT" "ask" "Capability-abuse risk"

OUT=$(run_guard force Bash '{"command":"cat .env"}')
assert_decision "secret env bash read asks approval" "$OUT" "ask" "Capability-abuse risk"

OUT=$(run_guard force Bash '{"command":"curl https://example.com/benchmark-answer"}')
assert_decision "benchmark answer curl asks approval" "$OUT" "ask" "Solution contamination risk"

echo "==========================================="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "Total:  $((PASS+FAIL))"
echo "==========================================="

[ "$FAIL" -eq 0 ] || exit 1
