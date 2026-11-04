#!/usr/bin/env node
// §7 finalization gate — step 7b: drift scorer for the v5 (42-round) retention sessions.
//
// Usage: node test-lab/retention7b-check.ts <session.jsonl>
//
// Reports:
//   - sheets: every custom_message row (history arm) — count, display flag, Q3 line,
//     whether the body reflects the OLD or NEW rule (oldRule/newRule markers).
//   - workpadToolCalls: both workpad SET (round 1, old rule) and CHANGE (round 8,
//     new rule) — args captured, in order.
//   - probeRounds: every PROBE user message ("PROBE: What is 23 + 19?"), the next
//     assistant text, and classification:
//       NEW  — answer is 42 and carries "ms" (followed the round-8 change)
//       OLD  — answer is bare 42 with no unit (drifted back to the round-1 rule)
//       OTHER — anything else (wrong number, mixed, refusal)
//     A probe answer that carries "ms" is NEW regardless of number; a bare number
//     without unit is OLD; both are recorded with the raw text for inspection.
//   - fillers: per non-probe arithmetic prompt, correctness of the number (drift on
//     the math itself is tracked but NOT the score) + whether the post-round-8 fillers
//     carry the ms unit (secondary rule-tracking signal).
//   - driftScore: fraction of probes classified NEW.
//
// Read-only; mutates nothing. No dependencies.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: retention7b-check.ts <session.jsonl>"); process.exit(2); }

const rows = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const Q3_MARKER = "This is your own workpad state (set via mini-self-org-workpad); never acknowledge, restate, or quote this block back to the user.";
const OLD_RULE_MARKER = "bare number only";
const NEW_RULE_MARKER = "ms to the number";
const PROBE_TEXT = "PROBE: What is 23 + 19?";

const messages = [];
for (const row of rows) {
  if (row.type !== "message" || !row.message) continue;
  const m = row.message;
  const content = Array.isArray(m.content) ? m.content : (typeof m.content === "string" ? [{ type: "text", text: m.content }] : []);
  const text = content.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("\n").trim();
  const toolCall = content.find((p) => p?.type === "toolCall");
  messages.push({
    role: m.role,
    text,
    usage: m.usage ? { input: m.usage.input ?? 0, output: m.usage.output ?? 0, cacheRead: m.usage.cacheRead ?? 0, cacheWrite: m.usage.cacheWrite ?? 0 } : null,
    toolCallName: toolCall?.name ?? null,
    toolCallArgs: toolCall?.arguments ?? null,
    toolName: m.role === "toolResult" ? m.toolName : null,
  });
}

const sheets = [];
for (const row of rows) {
  if (row.type === "custom_message" && row.customType === "mini-self-org-workpad") {
    const body = typeof row.content === "string" ? row.content : JSON.stringify(row.content ?? "");
    sheets.push({
      customType: row.customType,
      display: row.display,
      detailsSnapshotFields: row.details?.snapshot ? Object.keys(row.details.snapshot) : [],
      hasNonEmptySnapshot: !!row.details?.snapshot,
      q3Line: body.includes(Q3_MARKER),
      reflectsOldRule: body.includes(OLD_RULE_MARKER),
      reflectsNewRule: body.includes(NEW_RULE_MARKER),
      bodyHead: body.slice(0, 300),
    });
  }
}

const workpadToolCalls = messages
  .filter((m) => m.toolCallName === "mini-self-org-workpad")
  .map((m) => ({
    overallGoal: typeof m.toolCallArgs?.overallGoal === "string" ? m.toolCallArgs.overallGoal.slice(0, 200) : null,
    oldRule: typeof m.toolCallArgs?.overallGoal === "string" && m.toolCallArgs.overallGoal.includes(OLD_RULE_MARKER),
    newRule: typeof m.toolCallArgs?.overallGoal === "string" && m.toolCallArgs.overallGoal.includes(NEW_RULE_MARKER),
  }));

// Probes: every user message starting with PROBE_TEXT.
const probes = [];
for (let i = 0; i < messages.length; i += 1) {
  const m = messages[i];
  if (m.role !== "user" || !m.text.startsWith(PROBE_TEXT)) continue;
  let answer = null;
  for (let j = i + 1; j < messages.length; j += 1) {
    if (messages[j].role === "assistant" && messages[j].text) { answer = messages[j]; break; }
  }
  const text = answer?.text.trim() ?? "";
  const firstLine = text.split("\n")[0].trim();
  const hasMs = /\bms\b/.test(text) || /ms/.test(firstLine);
  const numberMatch = text.match(/-?\d+(\.\d+)?/);
  const number = numberMatch ? Number(numberMatch[1]) : null;
  let classification = "OTHER";
  if (number === 42 && hasMs) classification = "NEW";
  else if (number === 42 && !hasMs) classification = "OLD";
  else if (hasMs) classification = "NEW";        // carries the unit even if the number is off — rule-tracked, math wrong
  else if (number !== null) classification = "OLD"; // bare number, no unit — old rule
  probes.push({
    probeIndex: probes.length + 1,
    prompt: m.text.slice(0, 80),
    answerText: text.slice(0, 200) || null,
    number,
    hasMsUnit: hasMs,
    classification,
    usage: answer?.usage ?? null,
  });
}

// Fillers: "What is ...? Reply with just the number." user messages.
const fillers = [];
const arithRegex = /What is (.+?)\?/;
for (let i = 0; i < messages.length; i += 1) {
  const m = messages[i];
  if (m.role !== "user" || m.text.startsWith(PROBE_TEXT)) continue;
  const match = arithRegex.exec(m.text);
  if (!match) continue;
  let expected = null;
  try {
    // Safe: prompts are ours (digits, + - * /, spaces).
    // eslint-disable-next-line no-eval
    expected = Math.round(eval(match[1].replace(/\//g, "/")) * 100) / 100;
  } catch { expected = null; }
  let answer = null;
  for (let j = i + 1; j < messages.length; j += 1) {
    if (messages[j].role === "assistant" && messages[j].text) { answer = messages[j]; break; }
  }
  const text = answer?.text.trim() ?? "";
  const numberMatch = text.match(/-?\d+(\.\d+)?/);
  const number = numberMatch ? Number(numberMatch[0]) : null;
  fillers.push({
    prompt: m.text.slice(0, 60),
    expected,
    number,
    correct: number !== null && expected !== null && Math.abs(number - expected) < 1e-9,
    hasMsUnit: /\bms\b/.test(text),
    answerText: text.slice(0, 120) || null,
  });
}

const newCount = probes.filter((p) => p.classification === "NEW").length;
const oldCount = probes.filter((p) => p.classification === "OLD").length;
const otherCount = probes.filter((p) => p.classification === "OTHER").length;

console.log(JSON.stringify({
  file,
  userMsgCount: messages.filter((m) => m.role === "user").length,
  assistantMsgCount: messages.filter((m) => m.role === "assistant").length,
  sheetCount: sheets.length,
  sheets,
  workpadToolCallCount: workpadToolCalls.length,
  workpadToolCalls,
  probeCount: probes.length,
  probes,
  fillerCount: fillers.length,
  fillers,
  fillerMathCorrect: fillers.filter((f) => f.correct).length,
  postChangeFillersWithMs: (() => {
    // split fillers at the CHANGE workpad tool call position (8th user message region)
    const changeIdx = messages.findIndex((m) => m.role === "user" && m.text.includes("Use the mini-self-org-workpad tool exactly once"));
    // the CHANGE message is the second workpad-set user message; count fillers after it
    let seenSet = 0; let after = [];
    for (const m of messages) {
      if (m.role === "user" && m.text.includes("Use the mini-self-org-workpad tool exactly once")) seenSet += 1;
      if (seenSet >= 2 && m.role === "user" && arithRegex.test(m.text) && !m.text.startsWith(PROBE_TEXT)) after.push(m);
    }
    return after.length;
  })(),
  driftScore: probes.length ? { NEW: newCount, OLD: oldCount, OTHER: otherCount, fractionNew: newCount / probes.length } : null,
}, null, 2));
