// G5-style cache probe logger for the mini-self-org arms (§8 step 7c).
//
// Loaded explicitly by test-lab/cache-probe-msr.sh alongside the REAL
// mini-self-org extension (src/mini-self-org.ts). This extension only OBSERVES:
// it records the serialized provider payload shape + Pi usage counters and never
// modifies the payload (no provider-payload surgery). It appends a run-unique
// workpad-shaped tail sheet via the `context` hook so that A1/A2 (stable tail)
// and B1/B2 (changed tail) differ by exactly one tail — mirroring the G5
// A1/A2/B1/B2 protocol. The three arms differ only in MINI_SELF_ORG_INJECTION,
// so the real extension's own mechanism decides whether/how the workpad sheet
// is injected: the observed payload therefore contains the arm's real behavior.
//
// Env (all required): CACHE_MSR_RUN_ID, CACHE_MSR_ARM, CACHE_MSR_STEP,
// CACHE_MSR_REQUEST_UUID, CACHE_MSR_TAIL_VALUE, CACHE_MSR_PROVIDER,
// CACHE_MSR_MODEL, CACHE_MSR_LOG
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STEPS = new Set(["A1", "A2", "B1", "B2"]);
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`cache-probe-msr requires ${name}`);
  return value;
}

const probe = {
  runId: required("CACHE_MSR_RUN_ID"),
  arm: required("CACHE_MSR_ARM"),
  step: required("CACHE_MSR_STEP"),
  requestUuid: required("CACHE_MSR_REQUEST_UUID"),
  tail: required("CACHE_MSR_TAIL_VALUE"),
  provider: required("CACHE_MSR_PROVIDER"),
  model: required("CACHE_MSR_MODEL"),
  logFile: resolve(required("CACHE_MSR_LOG")),
};
if (!STEPS.has(probe.step)) throw new Error("CACHE_MSR_STEP must be A1, A2, B1, or B2");

function append(record: Record<string, unknown>): void {
  mkdirSync(dirname(probe.logFile), { recursive: true });
  appendFileSync(probe.logFile, `${JSON.stringify({ timestamp: new Date().toISOString(), runId: probe.runId, arm: probe.arm, step: probe.step, requestUuid: probe.requestUuid, ...record })}\n`, "utf8");
}

// The workpad-shaped tail: same shape as the extension's own contextMessage()
// body, but with a run-unique marker so A and B tails differ by exactly one tail.
// (The REAL extension also appends its own sheet when its policy says to — that
// is the arm under test and is counted in the payload below.)
function workpadTail(): string {
  return [
    `Mini self-org workpad — cache-probe tail (${probe.arm}/${probe.step})`,
    `Trailing sheet value: ${probe.tail}`,
    "Overall goal: Answer every arithmetic question with the bare number only.",
    "Current focus: Recall probe.",
  ].join("\n");
}

let observedRequest = false;

export default function cacheProbeMiniSelfOrg(pi: ExtensionAPI): void {
  pi.on("context", (event) => {
    const messages = [...event.messages];
    // Deterministic timestamp: the probe validates A1=A2 / B1=B2 raw payload
    // equality. Date.now() would break it; the run-unique tail already
    // differentiates runs, so a fixed timestamp is safe for probe payloads.
    const tail = workpadTail();
    messages.push({ role: "custom", customType: "msr-cache-probe-sheet", content: tail, display: false, timestamp: 0 });
    const sheetBytes = Buffer.byteLength(tail);
    const realSheets = event.messages.filter((m) => m.role === "custom" && m.customType === "mini-self-org-workpad");
    append({
      kind: "context",
      arm: probe.arm,
      sheetBytes,
      sheetSha256: sha256(tail),
      realSheetCount: realSheets.length,
      realSheetBytes: realSheets.reduce((sum, m) => sum + Buffer.byteLength(m.content ?? ""), 0),
      totalCustomCount: messages.filter((m) => m.role === "custom").length,
      messageCount: messages.length,
      policy: process.env.MINI_SELF_ORG_INJECTION ?? "(unset)",
    });
    return { messages };
  });

  pi.on("before_provider_request", (event) => {
    observedRequest = true;
    const payloadJson = JSON.stringify(event.payload);
    // The workpad sheet under test: count occurrences of the real extension's
    // sheet marker (the Q3 self-ownership line) in the serialized payload.
    const realSheetMarkers = (payloadJson.match(/This is your own workpad state \(set via mini-self-org-workpad\)/g) ?? []).length;
    append({
      kind: "request",
      arm: probe.arm,
      provider: probe.provider,
      model: probe.model,
      rawPayloadHash: sha256(payloadJson),
      payloadBytes: Buffer.byteLength(payloadJson),
      realSheetMarkersInPayload: realSheetMarkers,
      validationOk: true,
    });
    // No payload modification — observation only.
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const usage = event.message.usage;
    if (!observedRequest || !usage || typeof usage.input !== "number" || typeof usage.cacheRead !== "number" || typeof usage.cacheWrite !== "number") {
      throw new Error("cache-probe-msr missing observed request or Pi usage counters");
    }
    append({
      kind: "responseUsage",
      arm: probe.arm,
      provider: probe.provider,
      model: probe.model,
      stopReason: event.message.stopReason,
      usage: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite },
    });
  });
}
