#!/usr/bin/env bash
# G5 cache-probe live invocation (NOT executed here):
# CACHE_PROBE_LIVE_CONFIRM=I_UNDERSTAND_THIS_SENDS_PROVIDER_REQUESTS \
#   ./test-lab/cache-probe-run.sh --provider google --model gemini-2.5-flash
#
# --dry-run performs no Pi/auth/provider process. Live mode sends four independent,
# stateless requests (--no-session): A1/A2 have the stable tail; B1/B2 the changed tail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=false
PROVIDER="anthropic"
MODEL=""
RUN_ID="g5-$(date +%Y%m%dT%H%M%S)-$(uuidgen | tr '[:upper:]' '[:lower:]')"

usage() { echo "usage: $0 [--dry-run] [--provider anthropic|google|github-copilot|cerebras|wafer] --model MODEL [--run-id ID]" >&2; exit 2; }
while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --provider) PROVIDER="${2:-}"; [[ "$PROVIDER" == anthropic || "$PROVIDER" == google || "$PROVIDER" == github-copilot || "$PROVIDER" == cerebras || "$PROVIDER" == wafer ]] || { echo "Only providers anthropic, google, github-copilot, cerebras, and wafer are supported." >&2; exit 2; }; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$MODEL" && "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] || usage
LOG_FILE="$ROOT/test-lab/cache-probe-${RUN_ID}.jsonl"

interpretation_warning() {
  if [[ "$PROVIDER" == google ]]; then
    echo "Google profile: Gemini implicit caching has no explicit request marker in Pi; cacheRead is provider-reported evidence only, and cacheWrite=0 is expected adapter behavior, not a failed write."
  elif [[ "$PROVIDER" == github-copilot ]]; then
    echo "GitHub Copilot profile: OpenAI Responses cached_tokens/cache_write_tokens are mapped to Pi cacheRead/cacheWrite; counters remain provider-reported evidence, not causal proof."
  elif [[ "$PROVIDER" == cerebras || "$PROVIDER" == wafer ]]; then
    echo "$PROVIDER profile: OpenAI Completions cached-token fields map to Pi cacheRead/cacheWrite when the endpoint emits them; zero counters may be counter-blind rather than proof of no backend cache."
  else
    echo "Anthropic profile: cache_control markers prove serialized placement only; counters do not establish provider causality by themselves."
  fi
}

if "$DRY_RUN"; then
  echo "DRY RUN: no Pi/auth/provider process will run."
  printf 'provider=%s model=%s runId=%s\n' "$PROVIDER" "$MODEL" "$RUN_ID"
  interpretation_warning
  printf 'stateless steps=A1,A2,B1,B2; log=%s (ignored by *.jsonl)\n' "$LOG_FILE"
  exit 0
fi
[[ "${CACHE_PROBE_LIVE_CONFIRM:-}" == "I_UNDERSTAND_THIS_SENDS_PROVIDER_REQUESTS" ]] || { echo "Refusing live execution. Set CACHE_PROBE_LIVE_CONFIRM=I_UNDERSTAND_THIS_SENDS_PROVIDER_REQUESTS." >&2; exit 2; }
interpretation_warning

# Neither command prints credential values. Auth check does not refresh credentials.
pi auth check --no-refresh --provider "$PROVIDER" --model "$MODEL"
pi --offline --no-extensions --list-models "$PROVIDER/$MODEL" | awk -v provider="$PROVIDER" -v model="$MODEL" '$1 == provider && $2 == model { found = 1 } END { exit !found }'

verify_step() {
  local step="$1" request_uuid="$2"
  node - "$LOG_FILE" "$RUN_ID" "$step" "$request_uuid" "$MODEL" "$PROVIDER" <<'NODE'
const [file, runId, step, requestUuid, model, provider] = process.argv.slice(2);
const rows = require("node:fs").readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  .filter(row => row.runId === runId && row.step === step && row.requestUuid === requestUuid);
const one = kind => rows.filter(row => row.kind === kind);
const [context] = one("context"), [request] = one("request"), [response] = one("responseUsage");
if (rows.length !== 3 || one("context").length !== 1 || one("request").length !== 1 || one("responseUsage").length !== 1) throw new Error(`${step}: expected exactly one context/request/response record`);
if (request.provider !== provider || response.provider !== provider || request.model !== model || response.model !== model) throw new Error(`${step}: provider/model mismatch`);
if (request.validationOk !== true) throw new Error(`${step}: serialized-payload validation failed (${request.validationErrorCode || "missing validation result"})`);
if (typeof request.rawPayloadHash !== "string" || typeof request.canonicalControlHash !== "string" || request.canonicalControlReplacements !== 1) throw new Error(`${step}: raw/canonical control hash evidence absent`);
if (response.stopReason === "error" || !Number.isFinite(response.usage?.input) || response.usage.input <= 0 || !Number.isFinite(response.usage?.cacheRead) || !Number.isFinite(response.usage?.cacheWrite)) throw new Error(`${step}: unsuccessful or incomplete Pi usage`);
if (provider === "anthropic") {
  if (!request.cacheMarkerPaths.some(path => path.endsWith(".cache_control"))) throw new Error(`${step}: Anthropic cache_control marker absent`);
  if (!context.systemAnchor || context.systemAnchor.bytes !== 16384) throw new Error(`${step}: Anthropic system anchor evidence absent`);
} else if (provider === "google") {
  if (request.cacheMarkerPaths.length !== 0) throw new Error(`${step}: Google request unexpectedly has an explicit cache marker`);
  const serialized = request.serialization;
  if (!serialized || serialized.systemInstruction?.anchorBytes !== 32768 || !Number.isFinite(serialized.systemInstruction?.bytes) || serialized.systemInstruction.bytes < 32768 || serialized.contents?.trailingSheetMatches !== 1 || !Number.isFinite(serialized.contents?.count) || serialized.contents.count < 1) throw new Error(`${step}: Google serialized provider/model/system/content evidence absent`);
  if (!context.systemAnchor || context.systemAnchor.bytes !== 32768) throw new Error(`${step}: Google system anchor evidence absent`);
  // Pi's Google adapter always maps cachedContentTokenCount to cacheRead and emits cacheWrite=0.
  // cacheWrite is intentionally validated only as a finite adapter counter above.
} else if (provider === "github-copilot") {
  if (request.cacheMarkerPaths.length !== 0) throw new Error(`${step}: Copilot Responses request unexpectedly has an explicit cache marker`);
  const serialized = request.serialization;
  if (!serialized || typeof serialized.promptCacheKeySha256 !== "string" || serialized.systemInstruction?.anchorBytes !== 32768 || !Number.isFinite(serialized.systemInstruction?.bytes) || serialized.systemInstruction.bytes < 32768 || serialized.input?.trailingSheetMatches !== 1 || !Number.isFinite(serialized.input?.count) || serialized.input.count < 1) throw new Error(`${step}: Copilot serialized provider/model/cache-key/system/input evidence absent`);
  if (!context.systemAnchor || context.systemAnchor.bytes !== 32768) throw new Error(`${step}: Copilot system anchor evidence absent`);
} else {
  if (request.cacheMarkerPaths.length !== 0) throw new Error(`${step}: OpenAI Completions request unexpectedly has an explicit cache marker`);
  const serialized = request.serialization;
  if (!serialized || serialized.systemInstruction?.anchorBytes !== 32768 || !Number.isFinite(serialized.systemInstruction?.bytes) || serialized.systemInstruction.bytes < 32768 || serialized.messages?.trailingSheetMatches !== 1 || !Number.isFinite(serialized.messages?.count) || serialized.messages.count < 1) throw new Error(`${step}: OpenAI Completions serialized provider/model/system/message evidence absent`);
  if (!context.systemAnchor || context.systemAnchor.bytes !== 32768) throw new Error(`${step}: OpenAI Completions system anchor evidence absent`);
}
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
  if (typeof row.rawPayloadHash !== "string" || typeof row.canonicalControlHash !== "string") throw new Error(`${step}: missing control hash`);
}
const equal = (left, right, label) => {
  if (byStep.has(left) && byStep.has(right) && byStep.get(left).rawPayloadHash !== byStep.get(right).rawPayloadHash) throw new Error(`${label}: raw payload hashes differ`);
};
equal("A1", "A2", "A1=A2");
equal("B1", "B2", "B1=B2");
if (byStep.has("A1") && byStep.has("B1") && byStep.get("A1").rawPayloadHash === byStep.get("B1").rawPayloadHash) throw new Error("A raw payload must differ from B raw payload");
const hashes = new Set([...byStep.values()].map(row => row.canonicalControlHash));
if (hashes.size > 1) throw new Error("canonical-control hashes must all match");
NODE
}

run_step() {
  local step="$1" tail="$2" request_uuid
  local -a pi_args=(--no-extensions --no-context-files --no-tools --no-session --print --provider "$PROVIDER" --model "$MODEL")
  request_uuid="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  # `--no-session --session-id` creates a fresh in-memory session for every process while
  # keeping Copilot's serialized prompt_cache_key stable across the four stateless calls.
  if [[ "$PROVIDER" == github-copilot ]]; then
    pi_args+=(--thinking minimal --session-id "$RUN_ID")
  elif [[ "$PROVIDER" == cerebras || "$PROVIDER" == wafer ]]; then
    # Both exposed OpenAI-compatible catalogs support `low`; Wafer rejects `minimal`.
    pi_args+=(--thinking low)
  fi
  CACHE_PROBE_RUN_ID="$RUN_ID" CACHE_PROBE_STEP="$step" CACHE_PROBE_REQUEST_UUID="$request_uuid" \
  CACHE_PROBE_TAIL_VALUE="$tail" CACHE_PROBE_PROVIDER="$PROVIDER" CACHE_PROBE_MODEL="$MODEL" CACHE_PROBE_LOG="$LOG_FILE" \
    pi "${pi_args[@]}" --extension "$ROOT/test-lab/cache-probe.ts" "Reply exactly READY."
  verify_step "$step" "$request_uuid"
  verify_controls
}

run_step A1 "SHEET_VALUE_STABLE"
run_step A2 "SHEET_VALUE_STABLE"
run_step B1 "SHEET_VALUE_CHANGED"
run_step B2 "SHEET_VALUE_CHANGED"
echo "Raw evidence written to $LOG_FILE; it is structural evidence, not provider-causality proof."
