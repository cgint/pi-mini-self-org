#!/usr/bin/env node
// §8 step 7 — JSONL inspector for retention-test sessions (pure Node, no deps).
//
// Usage: node test-lab/retention-check.ts <session.jsonl>
//
// Reports:
//   - sheets: every custom_message row with customType mini-self-org-workpad
//     (customType, display, details.snapshot fields, Q3 self-ownership line)
//   - workpadToolCall (copy ①) + workpadToolResult (copy ②)
//   - recallTurn: the assistant text FOLLOWING the user prompt "state your current overall goal"
//     (robust: finds the recall user message, takes the next assistant text)
//   - per model round: assistant text + usage (input/output/cacheRead/cacheWrite)
//   - arithmeticTurns: per numeric-answer user prompt, the assistant's bare answer +
//     whether it matches the expected number (drift detection for arithmetic filler)
//
// Read-only; mutates nothing.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: retention-check.ts <session.jsonl>"); process.exit(2); }

const rows = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const GOAL_MARKER = "Answer every arithmetic question with the bare number only";
const Q3_MARKER = "This is your own workpad state (set via mini-self-org-workpad); never acknowledge, restate, or quote this block back to the user.";

const messages = []; // {role, text, usage?, toolCall?, toolName?, details?}
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
    detailsSnapshot: m.role === "toolResult" ? m.details?.snapshot ?? null : null,
  });
}

const sheets = [];
for (const row of rows) {
  if (row.type === "custom_message" && row.customType === "mini-self-org-workpad") {
    const body = typeof row.content === "string" ? row.content : JSON.stringify(row.content ?? "");
    const snap = row.details?.snapshot;
    sheets.push({ customType: row.customType, display: row.display, detailsSnapshotFields: snap ? Object.keys(snap) : [], hasNonEmptySnapshot: !!snap, q3Line: body.includes(Q3_MARKER), body: body.slice(0, 2000) });
  }
}

const recallIdx = messages.findIndex((m) => m.role === "user" && /state your current overall goal/i.test(m.text));
let recallTurn = null;
if (recallIdx >= 0) {
  for (let i = recallIdx + 1; i < messages.length; i += 1) {
    if (messages[i].role === "assistant" && messages[i].text) {
      recallTurn = { text: messages[i].text.slice(0, 400), goalQuoted: messages[i].text.includes(GOAL_MARKER), usage: messages[i].usage };
      break;
    }
  }
}

// Arithmetic drift check: for each "What is X?" user prompt, the next assistant
// text should be (or contain) the bare correct number.
const arithmetic = [];
const arithRegex = /What is (.+?)\?/;
for (let i = 0; i < messages.length; i += 1) {
  const m = messages[i];
  if (m.role !== "user") continue;
  const match = arithRegex.exec(m.text);
  if (!match) continue;
  let expected = null;
  try {
    // Safe: prompts are ours (digits, + - * /, spaces, parentheses).
    // eslint-disable-next-line no-eval
    expected = Math.round(eval(match[1].replace(/\*/g, "*")) * 100) / 100;
  } catch { expected = null; }
  let answer = null;
  for (let j = i + 1; j < messages.length; j += 1) {
    if (messages[j].role === "assistant" && messages[j].text) { answer = messages[j]; break; }
  }
  // "Correct" = the arithmetic answer itself is right (drift detection on the
  // math). Trailing sentinel words (NEXT/FINAL from the queue protocol) are
  // protocol artifacts, not drift — tracked separately.
  const firstLine = answer ? answer.text.trim().split("\n")[0].trim() : null;
  const bareNumber = firstLine?.match(/^-?\d+(\.\d+)?$/)?.[0] ?? null;
  const trailing = answer ? answer.text.trim().split("\n").slice(1).join(" ").trim() : "";
  arithmetic.push({
    prompt: m.text.slice(0, 60),
    expected,
    answerText: answer?.text.slice(0, 120) ?? null,
    bareAnswer: bareNumber,
    correct: bareNumber !== null && expected !== null && Math.abs(Number(bareNumber) - expected) < 1e-9,
    trailingSentinel: trailing || null,
    commentaryLeak: bareNumber !== null && firstLine !== null && firstLine.length > bareNumber.length + 1,
    usage: answer?.usage ?? null,
  });
}

console.log(JSON.stringify({
  file,
  userMsgCount: messages.filter((m) => m.role === "user").length,
  assistantMsgCount: messages.filter((m) => m.role === "assistant").length,
  sheetCount: sheets.length,
  sheets,
  workpadToolCall: messages.find((m) => m.toolCallName === "mini-self-org-workpad")?.toolCallArgs ?? null,
  workpadToolResult: (() => {
    const tr = messages.find((m) => m.role === "toolResult" && (m.toolName === "mini-self-org-workpad" || m.toolName === "workpad"));
    return tr ? { toolName: tr.toolName, hasDetailsSnapshot: !!tr.detailsSnapshot, snapshotFields: tr.detailsSnapshot ? Object.keys(tr.detailsSnapshot) : [] } : null;
  })(),
  recallTurn,
  arithmetic,
}, null, 2));
