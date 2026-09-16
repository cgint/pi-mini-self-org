// G5 cache-probe harness — test-lab only; never shipped or auto-loaded.
// Loaded explicitly by cache-probe-run.sh. It observes provider serialization only:
// it never returns a replacement payload and never logs payload text or headers.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ANTHROPIC = "anthropic";
const GOOGLE = "google";
const PROFILES = new Set([ANTHROPIC, GOOGLE]);
const ANCHOR_BYTES = { [ANTHROPIC]: 16_384, [GOOGLE]: 32_768 } as const;
const SHEET_TYPE = "g5-cache-probe-sheet";
const STEPS = new Set(["A1", "A2", "B1", "B2"]);
const CONTROL_SENTINEL = "__G5_TRAILING_SHEET_CONTROL__";

type Profile = typeof ANTHROPIC | typeof GOOGLE;
type ProbeConfig = { runId: string; step: string; requestUuid: string; tail: string; provider: Profile; model: string; logFile: string };
type UnknownRecord = Record<string, unknown>;
type Validation = { validationOk: true; serialization?: UnknownRecord } | { validationOk: false; validationErrorCode: string };

class ProbeValidationError extends Error {
  constructor(readonly code: string) { super(code); }
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`cache-probe requires ${name}`);
  return value;
}
function config(): ProbeConfig {
  const provider = required("CACHE_PROBE_PROVIDER");
  if (!PROFILES.has(provider)) throw new Error("cache-probe supports only providers anthropic and google");
  const step = required("CACHE_PROBE_STEP");
  if (!STEPS.has(step)) throw new Error("CACHE_PROBE_STEP must be A1, A2, B1, or B2");
  return { runId: required("CACHE_PROBE_RUN_ID"), step, requestUuid: required("CACHE_PROBE_REQUEST_UUID"), tail: required("CACHE_PROBE_TAIL_VALUE"), provider: provider as Profile, model: required("CACHE_PROBE_MODEL"), logFile: resolve(required("CACHE_PROBE_LOG")) };
}
function stableAnchor(provider: Profile): string {
  // 32 KiB of ordinary text gives the Google profile ample margin over Gemini's documented
  // implicit-cache token minima while retaining a byte-counted, reproducible anchor.
  const unit = "stable G5 cache anchor retained verbatim in the system prompt. ";
  const bytes = ANCHOR_BYTES[provider];
  return unit.repeat(Math.ceil(bytes / Buffer.byteLength(unit))).slice(0, bytes);
}
function payloadShape(value: unknown, path = "$", markers: string[] = []): unknown {
  if (typeof value === "string") return { type: "string", bytes: Buffer.byteLength(value), sha256: sha256(value) };
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item, index) => payloadShape(item, `${path}[${index}]`, markers));
  if (typeof value === "object") {
    const shape: UnknownRecord = {};
    for (const [key, item] of Object.entries(value as UnknownRecord)) {
      const childPath = `${path}.${key}`;
      if (key === "cache_control" || key === "cachedContent") markers.push(childPath);
      shape[key] = payloadShape(item, childPath, markers);
    }
    return shape;
  }
  return { type: typeof value };
}
function append(probe: ProbeConfig, record: UnknownRecord): void {
  mkdirSync(dirname(probe.logFile), { recursive: true });
  appendFileSync(probe.logFile, `${JSON.stringify({ timestamp: new Date().toISOString(), runId: probe.runId, step: probe.step, requestUuid: probe.requestUuid, ...record })}\n`, "utf8");
}
function record(value: unknown, code: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProbeValidationError(code);
  return value as UnknownRecord;
}
function validateGooglePayload(payload: unknown, probe: ProbeConfig): UnknownRecord {
  const request = record(payload, "GOOGLE_REQUEST_SHAPE");
  const requestConfig = record(request.config, "GOOGLE_CONFIG_SHAPE");
  const systemInstruction = requestConfig.systemInstruction;
  const contents = request.contents;
  if (request.model !== probe.model) throw new ProbeValidationError("GOOGLE_MODEL_MISMATCH");
  if (typeof systemInstruction !== "string" || !Array.isArray(contents)) throw new ProbeValidationError("GOOGLE_SYSTEM_OR_CONTENTS_SHAPE");
  const anchor = stableAnchor(GOOGLE);
  if (!systemInstruction.endsWith(anchor)) throw new ProbeValidationError("GOOGLE_SYSTEM_ANCHOR_ABSENT");
  const tailContent = `Trailing sheet value: ${probe.tail}`;
  let tailMatches = 0;
  for (const content of contents) {
    if (!content || typeof content !== "object" || Array.isArray(content)) continue;
    const parts = (content as UnknownRecord).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) if (part && typeof part === "object" && !Array.isArray(part) && (part as UnknownRecord).text === tailContent) tailMatches++;
  }
  if (tailMatches !== 1) throw new ProbeValidationError("GOOGLE_TRAILING_SHEET_MISMATCH");
  return { systemInstruction: { bytes: Buffer.byteLength(systemInstruction), sha256: sha256(systemInstruction), anchorBytes: ANCHOR_BYTES[GOOGLE], anchorSha256: sha256(anchor) }, contents: { count: contents.length, trailingSheetMatches: tailMatches, trailingSheet: { bytes: Buffer.byteLength(tailContent), sha256: sha256(tailContent) } } };
}
function validatePayload(payload: unknown, probe: ProbeConfig, cacheMarkerPaths: string[]): Validation {
  try {
    if (probe.provider === ANTHROPIC) {
      const request = record(payload, "ANTHROPIC_REQUEST_SHAPE");
      if (request.model !== probe.model) throw new ProbeValidationError("ANTHROPIC_MODEL_MISMATCH");
      const system = request.system;
      const messages = request.messages;
      if (!Array.isArray(system) || !system.some((block) => record(block, "ANTHROPIC_SYSTEM_BLOCK").cache_control)) {
        throw new ProbeValidationError("ANTHROPIC_SYSTEM_CACHE_MARKER_ABSENT");
      }
      if (!Array.isArray(messages) || messages.length === 0) throw new ProbeValidationError("ANTHROPIC_MESSAGES_SHAPE");
      const finalMessage = record(messages.at(-1), "ANTHROPIC_FINAL_MESSAGE");
      const finalContent = finalMessage.content;
      if (finalMessage.role !== "user" || !Array.isArray(finalContent) || finalContent.length === 0 || !record(finalContent.at(-1), "ANTHROPIC_FINAL_BLOCK").cache_control) {
        throw new ProbeValidationError("ANTHROPIC_FINAL_MESSAGE_CACHE_MARKER_ABSENT");
      }
      return { validationOk: true };
    }
    return { validationOk: true, serialization: validateGooglePayload(payload, probe) };
  } catch (error) {
    return { validationOk: false, validationErrorCode: error instanceof ProbeValidationError ? error.code : "VALIDATION_EXCEPTION" };
  }
}
function canonicalControlHash(payload: unknown, tailContent: string): { hash: string; replacements: number } {
  const control = structuredClone(payload);
  let replacements = 0;
  const replace = (value: unknown): unknown => {
    if (value === tailContent) { replacements++; return CONTROL_SENTINEL; }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as UnknownRecord)) (value as UnknownRecord)[key] = replace(child);
    }
    return value;
  };
  const canonical = replace(control);
  return { hash: sha256(JSON.stringify(canonical)), replacements };
}

export default function cacheProbe(pi: ExtensionAPI): void {
  const probe = config();
  let observedRequest = false;

  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx.model || ctx.model.provider !== probe.provider || ctx.model.id !== probe.model) throw new Error("cache-probe active model mismatch");
    return { systemPrompt: `${event.systemPrompt}\n\n${stableAnchor(probe.provider)}` };
  });
  pi.on("context", (event) => {
    const messages = event.messages.filter((message) => message.role !== "custom" || message.customType !== SHEET_TYPE);
    const content = `Trailing sheet value: ${probe.tail}`;
    messages.push({ role: "custom", customType: SHEET_TYPE, content, display: false, timestamp: Date.now() });
    append(probe, { kind: "context", roles: messages.map((message) => message.role === "custom" ? `custom:${message.customType}` : message.role), sheet: { bytes: Buffer.byteLength(content), tailBytes: Buffer.byteLength(probe.tail), tailSha256: sha256(probe.tail) }, systemAnchor: { bytes: ANCHOR_BYTES[probe.provider], sha256: sha256(stableAnchor(probe.provider)) } });
    return { messages };
  });
  pi.on("before_provider_request", (event) => {
    observedRequest = true;
    const cacheMarkerPaths: string[] = [];
    const payload = payloadShape(event.payload, "$", cacheMarkerPaths);
    const rawPayloadHash = sha256(JSON.stringify(event.payload));
    const canonicalControl = canonicalControlHash(event.payload, `Trailing sheet value: ${probe.tail}`);
    const validation = canonicalControl.replacements === 1
      ? validatePayload(event.payload, probe, cacheMarkerPaths)
      : { validationOk: false as const, validationErrorCode: "CANONICAL_TRAILING_SHEET_MISMATCH" };
    append(probe, { kind: "request", provider: probe.provider, model: probe.model, rawPayloadHash, canonicalControlHash: canonicalControl.hash, canonicalControlReplacements: canonicalControl.replacements, payload, cacheMarkerPaths, ...validation });
    // Undefined return deliberately preserves the exact provider payload. Pi exposes this hook
    // immediately before transport, but offers no supported inspect-and-abort contract for A1.
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const usage = event.message.usage;
    if (!observedRequest || !usage || typeof usage.input !== "number" || typeof usage.cacheRead !== "number" || typeof usage.cacheWrite !== "number") throw new Error("cache-probe missing observed request or Pi usage counters");
    append(probe, { kind: "responseUsage", provider: probe.provider, model: probe.model, stopReason: event.message.stopReason, usage: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite } });
  });
}
