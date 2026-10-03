#!/usr/bin/env bash
# §8 step 7 (7c) — Gemini cache A/B probe: warm-prefix retention with a
# changed tail, per injection arm.
#
# STATUS: OBSERVATIONAL (matrix contract). The stateless G5 A1/A2/B1/B2
# raw-payload-equality control CANNOT be applied to these arms without
# provider-payload surgery: the real extension's transient workpad sheet
# (always/scheduled arms) carries Date.now() and varies per call by design;
# the history arm's sheet is appended to the SESSION transcript at turn_end
# (not to the per-call payload). Both facts are load-bearing and are verified,
# not hidden: every step records realSheetMarkersInPayload (0 expected for all
# arms in stateless mode — the sheet's home is the session, not the request)
# and the structural byte-stability check below.
#
# What this probe measures (honest scope):
#   - Warm-prefix reuse on gemini-3.7-flash when the request tail changes
#     (A->B) under each arm's REAL extension loaded alongside a logger
#     (cacheRead per step; Gemini implicit caching, provider-reported only).
#   - Sheet-body cost: the probe logger appends a deterministic workpad-shaped
#     tail (~257–265 bytes) so the A/B tail delta is a controlled, measured
#     quantity — standing in for one sheet body in the payload.
#   - It does NOT measure the history arm's appended sheet in a live request
#     (that requires a session; see retention-run.sh + the retention section).
#
# Controls (weakened vs G5, documented):
#   - Structural byte stability within step pairs (A1/A2, B1/B2): any byte
#     drift > 64 fails. Raw-hash equality is intentionally NOT asserted.
#   - Per-step validation: exactly one context/request/responseUsage record,
#     provider/model match, successful usage.
#   - Live-confirm guard: same CACHE_PROBE_LIVE_CONFIRM as cache-probe-run.sh.
#
# Usage:
#   CACHE_PROBE_LIVE_CONFIRM=I_UNDERSTAND_THIS_SENDS_PROVIDER_REQUESTS \
#     ./test-lab/cache-probe-msr.sh --arm always  --provider google --model gemini-3.7-flash
#
# Output: test-lab/cache-probe-msr-<arm>-<runid>.jsonl
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARM=""
PROVIDER="google"
MODEL=""
RUN_ID=""
while (($#)); do
  case "$1" in
    --arm) ARM="${2:-}"; shift 2 ;;
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    *) echo "usage: $0 --arm always|scheduled4|history4 --provider google --model MODEL" >&2; exit 2 ;;
  esac
done
[[ -n "$ARM" && -n "$MODEL" ]] || { echo "missing args" >&2; exit 2; }
[[ "$PROVIDER" == "google" ]] || { echo "only google is supported for this probe" >&2; exit 2; }
case "$ARM" in
  always)   POLICY="always" ;;
  scheduled4) POLICY="scheduled:4" ;;
  history4) POLICY="history-scheduled:4" ;;
  *) echo "unknown arm" >&2; exit 2 ;;
esac
[[ -z "$RUN_ID" ]] && RUN_ID="cache-msr-$ARM-$(date +%Y%m%dT%H%M%S)-$(uuidgen | tr '[:upper:]' '[:lower:]')"
[[ "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad run-id" >&2; exit 2; }
LOG_FILE="$ROOT/test-lab/cache-probe-msr-$ARM-$RUN_ID.jsonl"
: > "$LOG_FILE"

echo "Google profile: Gemini implicit caching has no explicit request marker in Pi; cacheRead is provider-reported evidence only; cacheWrite=0 is expected adapter behavior, not a failed write." >&2

pi auth check --no-refresh --provider google --model "$MODEL"
pi --offline --no-extensions --list-models "google/$MODEL" | awk -v provider="google" -v model="$MODEL" '$1 == provider && $2 == model { found = 1 } END { exit !found }'
echo "auth+catalog ok: google/$MODEL" >&2

[[ "${CACHE_PROBE_LIVE_CONFIRM:-}" == "I_UNDERSTAND_THIS_SENDS_PROVIDER_REQUESTS" ]] || { echo "Refusing live execution. Set CACHE_PROBE_LIVE_CONFIRM=I_UNDERSTAND_THIS_SENDS_PROVIDER_REQUESTS." >&2; exit 2; }

TAIL_A="SHEET_A_${RUN_ID}"
TAIL_B="SHEET_B_${RUN_ID}"

run_step() {
  local step="$1" tail="$2" request_uuid
  request_uuid="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  echo "step=$step tail=$tail" >&2
  CACHE_MSR_RUN_ID="$RUN_ID" CACHE_MSR_ARM="$ARM" CACHE_MSR_STEP="$step" \
  CACHE_MSR_REQUEST_UUID="$request_uuid" CACHE_MSR_TAIL_VALUE="$tail" \
  CACHE_MSR_PROVIDER="google" CACHE_MSR_MODEL="$MODEL" CACHE_MSR_LOG="$LOG_FILE" \
  MINI_SELF_ORG_INJECTION="$POLICY" \
    pi --no-extensions --no-context-files --no-tools --no-session --print \
      --provider google --model "$MODEL" --thinking minimal \
      --extension "$ROOT/src/mini-self-org.ts" \
      --extension "$ROOT/test-lab/cache-probe-mini-self-org.ts" \
      "Reply exactly READY."
  node - "$LOG_FILE" "$RUN_ID" "$step" "$request_uuid" <<'NODE'
const [file, runId, step, requestUuid] = process.argv.slice(2);
const rows = require("node:fs").readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  .filter(row => row.runId === runId && row.step === step && row.requestUuid === requestUuid);
const one = kind => rows.filter(row => row.kind === kind);
if (rows.length !== 3 || one("context").length !== 1 || one("request").length !== 1 || one("responseUsage").length !== 1)
  throw new Error(`${step}: expected exactly one context/request/response record, got ${rows.length}`);
const [context] = one("context"), [request] = one("request"), [response] = one("responseUsage");
if (request.provider !== "google") throw new Error(`${step}: provider mismatch`);
if (request.validationOk !== true) throw new Error(`${step}: validation failed (${request.validationErrorCode})`);
if (response.stopReason === "error" || !Number.isFinite(response.usage?.input) || !Number.isFinite(response.usage?.cacheRead) || !Number.isFinite(response.usage?.cacheWrite))
  throw new Error(`${step}: unsuccessful or incomplete usage`);
console.log(`${step} ok: input=${response.usage.input} cacheRead=${response.usage.cacheRead} cacheWrite=${response.usage.cacheWrite} sheetBytes=${context.sheetBytes} realSheetCount=${context.realSheetCount} policy=${context.policy}`);
NODE
}

verify_controls() {
  node - "$LOG_FILE" "$RUN_ID" <<'NODE'
const [file, runId] = process.argv.slice(2);
const requests = require("node:fs").readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  .filter(row => row.runId === runId && row.kind === "request");
const byStep = new Map(requests.map(row => [row.step, row]));
for (const [step, row] of byStep) {
  if (row.validationOk !== true) throw new Error(`${step}: validation failure prevents subsequent requests`);
  if (typeof row.rawPayloadHash !== "string" || typeof row.payloadBytes !== "number") throw new Error(`${step}: missing payload evidence`);
}
// Structural control: payload bytes must be stable within a step pair except
// for the documented non-determinism (the real extension's transient sheet
// timestamp). A byte DELTA is reported; a size drift > 64 bytes is a failure.
const drift = (l, r, label) => {
  const d = Math.abs(byStep.get(l).payloadBytes - byStep.get(r).payloadBytes);
  if (d > 64) throw new Error(`${label}: payload byte drift ${d} exceeds tolerance (check non-determinism source)`);
  console.log(`${label}: payload bytes ${byStep.get(l).payloadBytes} vs ${byStep.get(r).payloadBytes} (delta ${d}) — raw hashes ${byStep.get(l).rawPayloadHash === byStep.get(r).rawPayloadHash ? "equal" : "differ (expected: transient sheet timestamp)"}`);
};
drift("A1", "A2", "A1/A2");
drift("B1", "B2", "B1/B2");
const ab = Math.abs(byStep.get("A1").payloadBytes - byStep.get("B1").payloadBytes);
console.log(`A1/B1: payload bytes ${byStep.get("A1").payloadBytes} vs ${byStep.get("B1").payloadBytes} (delta ${ab}) — must differ by exactly the tail length difference (0: equal-length run-unique tails)`);
if (ab !== 0) console.log("NOTE: A/B byte delta non-zero — tails are equal-length, so any delta indicates payload asymmetry; inspect before using cache counters.");
console.log("controls: structural check complete (raw-hash equality intentionally not asserted — see header for reason)");
NODE
}

run_step A1 "$TAIL_A"
run_step A2 "$TAIL_A"
run_step B1 "$TAIL_B"
run_step B2 "$TAIL_B"
verify_controls
echo "Raw evidence written to $LOG_FILE" >&2
