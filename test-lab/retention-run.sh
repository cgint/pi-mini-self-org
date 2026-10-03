#!/usr/bin/env bash
# §8 step 7 / §7 retention test — v4: single INVOCATION, exactly 14 model rounds.
#
# WHY SINGLE INVOCATION: `pi -p` processes queued user messages in the SAME
# process — the extension's in-memory turn_end counter (history-scheduled:N)
# accumulates across all model rounds within the invocation, while queued
# messages are persisted immediately (not replayed). Per-invocation scripting
# (one pi -p per user message) instead resets the counter on every new process
# via reconstruct() (session_start fires per process), so no sheet can ever
# append in that harness shape. This variant is the faithful scripted equivalent
# of an interactive 14-turn session.
#
# Shape: 14 user messages -> ~14 model rounds.
#   r1: set workpad (tool round)      r2: recall probe (history read, tool round)
#   r3-r14: arithmetic (bare-number answers; model may use zero or one tool)
# NOTE (verified live): each arithmetic round ends in a toolUse stop (the model
# satisfies the queued follow-up with a tool call), so turn_end fires once per
# model round and the counter sees ~15-16 fills over the session. At N=4 the
# history arm appends 4 sheets (turn-ends 4, 8, 12, 16) — one more than the
# 3-sheet expectation in a strict 14-round count. The extra sheet is a
# protocol artifact of the queued-message shape, not a cadence defect: the
# cadence itself (one sheet per N completed turn-ends) is unit-tested (T2/T3/T7)
# and observed here. Expect 3-4 sheets; record the actual count.
#
# Arms (same N=4, same model, same prompts):
#   history -> history-scheduled:4   (expect 3 sheets at turn-ends 4, 8, 12)
#   always  -> always                (0 persisted sheets: transient request-local)
#   nosheet -> history-scheduled:99  (0 persisted sheets: counter never fills)
#
# Usage:
#   ./test-lab/retention-run.sh --arm history --provider google --model gemini-3.7-flash
# Output: prints the session JSONL path on stdout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARM=""
PROVIDER=""
MODEL=""
while (($#)); do
  case "$1" in
    --arm) ARM="${2:-}"; shift 2 ;;
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    *) echo "usage: $0 --arm history|always|nosheet --provider P --model M" >&2; exit 2 ;;
  esac
done
[[ -n "$ARM" && -n "$PROVIDER" && -n "$MODEL" ]] || { echo "missing args" >&2; exit 2; }

case "$ARM" in
  history) POLICY="history-scheduled:4" ;;
  always)  POLICY="always" ;;
  nosheet) POLICY="history-scheduled:99" ;;
  *) echo "unknown arm: $ARM" >&2; exit 2 ;;
esac

SESSION_ID="retention-v4-$ARM-$(date +%Y%m%dT%H%M%S)"
export MINI_SELF_ORG_INJECTION="$POLICY"

echo "arm=$ARM policy=$POLICY model=$PROVIDER/$MODEL session=$SESSION_ID" >&2

ARITH=(
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
)

# Build the 14 queued user messages as separate -- args.
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

pi -p --provider "$PROVIDER" --model "$MODEL" \
  --session-id "$SESSION_ID" \
  --no-extensions \
  --extension "$ROOT/src/mini-self-org.ts" \
  --no-context-files --no-skills --no-prompt-templates --no-themes \
  --no-builtin-tools \
  --thinking low \
  -- \
  "$MSG1" \
  "$MSG2" \
  "${ARITH[@]}"

SESSION_DIR="$HOME/.pi/profiles/minimal/agent/sessions"
SESSION_FILE="$(find "$SESSION_DIR" -name "*_${SESSION_ID}.jsonl" 2>/dev/null | head -1)"
[[ -n "$SESSION_FILE" && -f "$SESSION_FILE" ]] || { echo "session file not found for id $SESSION_ID" >&2; exit 1; }
echo "$SESSION_FILE"
