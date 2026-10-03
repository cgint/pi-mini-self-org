#!/usr/bin/env bash
# §7 finalization gate — step 7b: LONGER DECISIVE RETENTION PROTOCOL (v5).
#
# Single INVOCATION, exactly 42 user messages -> ~42 model rounds.
# (Same single-invocation shape as step 7 v4: the extension's in-memory
# turn_end counter accumulates across model rounds within one pi -p process;
# per-invocation scripting would reset it via reconstruct().)
#
# State-change schedule (same for all three arms, N=4):
#   r1:  SET workpad — old rule: "bare number only, never add commentary or units"
#   r2:  recall probe (state the overall goal verbatim)
#   r3-r7:  arithmetic filler (old rule regime; 5 rounds)
#   r8:  CHANGE workpad — new rule: "append the unit 'ms' to every number"
#   r9-r11: arithmetic filler (new rule regime; 3 rounds)
#   r12-r42: arithmetic + old-vs-new PROBE rounds. The probe text is
#            IDENTICAL across all arms and rounds (no per-round fingerprinting):
#            "PROBE: What is 23 + 19? Follow your current workpad rule."
#            Correct NEW-rule answer: "42 ms"  / OLD-rule answer: "42".
#            Probes at r12, r16, r20, r24, r28, r32, r36, r40 (every 4 rounds).
#            8 probes per arm; 42 rounds total.
#
# Arms (same model google/gemini-3.7-flash, same N=4, same prompts):
#   history -> history-scheduled:4   (current code: sheets re-appended every 4 turns)
#   nosheet -> history-scheduled:99  (current code: counter never fills; copies ①/② only)
#   always  -> always                (PRE-STEP-8 code 823516d via --root:
#                       transient request-local sheet — true legacy control)
#
# Usage:
#   ./test-lab/retention7b-run.sh --arm history --provider google --model gemini-3.7-flash
#   ./test-lab/retention7b-run.sh --arm always --provider google --model gemini-3.7-flash \
#     --root /path/to/pre-step-8/worktree
# Output: prints the session JSONL path on stdout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARM=""
PROVIDER=""
MODEL=""
EXTRA_ROOT=""
while (($#)); do
  case "$1" in
    --arm) ARM="${2:-}"; shift 2 ;;
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --root) EXTRA_ROOT="${2:-}"; shift 2 ;;
    *) echo "usage: $0 --arm history|always|nosheet --provider P --model M [--root PRE_STEP8_DIR]" >&2; exit 2 ;;
  esac
done
[[ -n "$ARM" && -n "$PROVIDER" && -n "$MODEL" ]] || { echo "missing args" >&2; exit 2; }

case "$ARM" in
  history) POLICY="history-scheduled:4"; CODE_ROOT="$ROOT" ;;
  nosheet) POLICY="history-scheduled:99"; CODE_ROOT="$ROOT" ;;
  always)  POLICY="always"; CODE_ROOT="${EXTRA_ROOT:-$ROOT}"
           [[ -f "$CODE_ROOT/src/mini-self-org.ts" ]] || { echo "--root required for always arm (pre-step-8 worktree)" >&2; exit 2; } ;;
  *) echo "unknown arm: $ARM" >&2; exit 2 ;;
esac

SESSION_ID="retention7b-$ARM-$(date +%Y%m%dT%H%M%S)"
export MINI_SELF_ORG_INJECTION="$POLICY"

echo "arm=$ARM policy=$POLICY model=$PROVIDER/$MODEL session=$SESSION_ID codeRoot=$CODE_ROOT" >&2

# Fillers: 34 distinct arithmetic prompts ("Reply with just the number.")
FILLERS=(
  "What is 7 * 8? Reply with just the number."
  "What is 12 + 39? Reply with just the number."
  "What is 100 - 27? Reply with just the number."
  "What is 5 * 6? Reply with just the number."
  "What is 81 / 9? Reply with just the number."
  "What is 15 + 43? Reply with just the number."
  "What is 20 * 4? Reply with just the number."
  "What is 90 - 35? Reply with just the number."
  "What is 7 + 8 + 1? Reply with just the number."
  "What is 12 * 12? Reply with just the number."
  "What is 6 * 7? Reply with just the number."
  "What is 144 - 90? Reply with just the number."
  "What is 3 * 11? Reply with just the number."
  "What is 200 - 158? Reply with just the number."
  "What is 9 * 7? Reply with just the number."
  "What is 55 + 47? Reply with just the number."
  "What is 64 / 8? Reply with just the number."
  "What is 17 * 5? Reply with just the number."
  "What is 88 - 43? Reply with just the number."
  "What is 4 * 13? Reply with just the number."
  "What is 300 - 247? Reply with just the number."
  "What is 6 * 9? Reply with just the number."
  "What is 28 + 74? Reply with just the number."
  "What is 144 / 12? Reply with just the number."
  "What is 11 * 11? Reply with just the number."
  "What is 96 - 51? Reply with just the number."
  "What is 8 * 8? Reply with just the number."
  "What is 19 + 82? Reply with just the number."
  "What is 200 / 4? Reply with just the number."
  "What is 7 * 12? Reply with just the number."
  "What is 130 - 84? Reply with just the number."
  "What is 5 * 14? Reply with just the number."
  "What is 60 + 36? Reply with just the number."
  "What is 99 - 44? Reply with just the number."
)

PROBE='PROBE: What is 23 + 19? Follow your current workpad rule.'

MSG1='Use the mini-self-org-workpad tool exactly once, with exactly these values:
{
  "overallGoal": "Answer every arithmetic question with the bare number only, and never add commentary or units.",
  "currentFocus": "Recall probe: when asked to state the overall goal, quote it verbatim.",
  "nextActions": ["Stay on the arithmetic task until told otherwise."],
  "blockers": [],
  "notes": ["[verified] Workpad state set at turn 1."]
}
Then reply with just CONFIRMED.'

MSG2='Call mini-self-org-history with the default limit, then in one line state your current overall goal exactly as it is stored in your workpad.'

# r8: state CHANGE — replace the workpad with the NEW rule.
MSG8='Use the mini-self-org-workpad tool exactly once, with exactly these values:
{
  "overallGoal": "Answer every arithmetic question by appending the unit ms to the number, for example 12 ms.",
  "currentFocus": "State changed at this round: every arithmetic answer must now carry the ms unit.",
  "nextActions": ["Apply the ms-unit rule to every arithmetic answer from this point on."],
  "blockers": [],
  "notes": ["[verified] Workpad rule changed at turn 8; the bare-number rule is retired."]
}
Then reply with just CONFIRMED.'

# Build the 42 queued user messages.
ARGS=("$MSG1" "$MSG2")
# r3-r7: first 5 fillers
for i in 0 1 2 3 4; do ARGS+=("${FILLERS[$i]}"); done
ARGS+=("$MSG8")
# r9-r11: next 3 fillers
for i in 5 6 7; do ARGS+=("${FILLERS[$i]}"); done
# r12-r42: 31 messages, probes at offsets 0,4,8,12,16,20,24,28 (r12,16,20,24,28,32,36,40)
i=8
for n in $(seq 0 30); do
  case $((n % 4)) in
    0) ARGS+=("$PROBE") ;;
    *) ARGS+=("${FILLERS[$i]}"); i=$((i+1)) ;;
  esac
done
[[ ${#ARGS[@]} -eq 42 ]] || { echo "expected 42 queued messages, got ${#ARGS[@]}" >&2; exit 2; }

pi -p --provider "$PROVIDER" --model "$MODEL" \
  --session-id "$SESSION_ID" \
  --no-extensions \
  --extension "$CODE_ROOT/src/mini-self-org.ts" \
  --no-context-files --no-skills --no-prompt-templates --no-themes \
  --no-builtin-tools \
  --thinking low \
  -- \
  "${ARGS[@]}"

SESSION_DIR="$HOME/.pi/profiles/minimal/agent/sessions"
SESSION_FILE="$(find "$SESSION_DIR" -name "*_${SESSION_ID}.jsonl" 2>/dev/null | head -1)"
[[ -n "$SESSION_FILE" && -f "$SESSION_FILE" ]] || { echo "session file not found for id $SESSION_ID" >&2; exit 1; }
echo "$SESSION_FILE"
