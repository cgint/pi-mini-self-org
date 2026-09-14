// G1 measurement fixture — NOT shipped code, NOT loaded by the extension.
//
// Runs one task three times, differing ONLY in the injected framing, to test whether wording
// changes agent behaviour. Outside tsconfig "include" (index.ts, src/**, test/**) and outside
// vitest's test pattern, so it is neither typechecked into nor run by the shipped suite.
// src/ is deliberately untouched: editing the thing under test would contaminate the measurement
// and violate the repo's standing rule (no src change without a gate signal).
//
// Arms (env G1_FRAMING):
//   NEW — today's framing: current contextMessage() text + RECALL_GUIDANCE in promptGuidelines
//   OLD — pre-8ab3870 framing: older contextMessage() text (TOOL_NAME_GUIDANCE inline) and
//         promptGuidelines WITHOUT RECALL_GUIDANCE. 8ab3870's src diff is exactly those two
//         surfaces, so this replays the real pre-fix state rather than a paraphrase.
//   OFF — registers the tool and stores snapshots identically but injects nothing; differs from
//         NEW only by the presence of the block, isolating injection from wording.
//
// Shared pieces are IMPORTED, not copied: WorkpadParameters, HistoryParameters, emptySnapshot,
// sanitizeSnapshot, reconstructSnapshot, reconstructHistory, formatFocusHistory.
// Copied from src/mini-self-org.ts (names private there): WORKPAD_CUSTOM_TYPE, WORKPAD_TOOL_NAME,
// HISTORY_TOOL_NAME, the guidance constants, the workpad tool description, formatFields(),
// hasContent(), plus blockOld() from 8ab3870^. test-lab/drift-check.sh re-derives these copies from
// git and fails loudly on drift, so this file cannot silently diverge from what is shipped.
import { appendFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  HistoryParameters,
  WorkpadParameters,
  emptySnapshot,
  formatFocusHistory,
  reconstructHistory,
  reconstructSnapshot,
  sanitizeSnapshot,
  type WorkpadSnapshot,
} from "../src/mini-self-org.js";

interface WorkpadDetails {
  snapshot?: WorkpadSnapshot;
}

const WORKPAD_CUSTOM_TYPE = "mini-self-org-workpad";
const WORKPAD_TOOL_NAME = "mini-self-org-workpad";
const HISTORY_TOOL_NAME = "mini-self-org-history";

const TOOL_NAME_GUIDANCE = "The only registered mini-self-org tools are mini-self-org-workpad and mini-self-org-history; workpad alone is not registered and must never be called as a tool.";
const LIST_GUIDANCE = "Lists: 1–3 items typical (max 5).";
const EVIDENCE_TAG_GUIDANCE = "Use [unverified], [verified], or [research] as confidence labels on notes and blockers; they label steering items, not an evidence log.";
const NOTES_SEMANTICS = "notes are durable steering context — active hypotheses, working decisions, constraints — not logs, status, or findings.";
const DURABILITY_GUIDANCE = "Write only what is worth re-reading after ten more tool calls or a context compaction; anything already visible in the conversation, or stale by the next tool call, belongs in the conversation — not here.";
const RECALL_GUIDANCE = "The workpad block injected at the end of the conversation is your own recalled state, not user input: never acknowledge, restate, or quote it — use it to steer your next action.";
const STALE_STATE_GUIDANCE = `When your overall goal, current focus, plan, or blockers materially change, call mini-self-org-workpad to replace the complete snapshot before the next consequential tool/action batch — not after every tool result. ${TOOL_NAME_GUIDANCE} Do not merely state that it is stale; replace it. Do not update ritualistically after every tool; use meaningful state boundaries.`;

// Identical in every arm: the injected block is the only difference under test.
const WORKPAD_DESCRIPTION = `Your own scratchpad for organizing your work in this session — it steers your next moves; the human seeing it is a side effect, not the audience. Call mini-self-org-workpad proactively throughout substantive work. ${TOOL_NAME_GUIDANCE} Valid shape: { overallGoal: "…", currentFocus: "…", nextActions: ["…"], blockers: [], notes: [] }; lists are arrays, not JSON-encoded strings. ${LIST_GUIDANCE} overallGoal is the stable umbrella outcome for the current session-local work thread; currentFocus is the immediate bounded activity. ${NOTES_SEMANTICS} ${EVIDENCE_TAG_GUIDANCE} ${DURABILITY_GUIDANCE} The tool holds only the current snapshot; past snapshots can be read via mini-self-org-history. ${STALE_STATE_GUIDANCE} Set currentFocus to null to clear only the focus while retaining overallGoal. Clear every field only when the workpad no longer aids the current session. Do not use it for project memory, evidence logs, approved plans, or task tracking.`;

const HISTORY_DESCRIPTION = `Read the session-local focus history: a bounded, newest-last timeline of this branch's past mini-self-org-workpad snapshots (timestamps, which fields changed, cleared states). A non-authoritative memory aid — not task tracking, and never a replacement for re-deriving from evidence. It distinguishes each work thread's overall goal from its current focus. Call it deliberately: after context compaction, after long interruptions, before clearing the workpad, or before starting a new work thread, to re-orient to the overall goal. Read-only: it performs no writes.`;

function formatFields(snapshot: WorkpadSnapshot): string {
  const formatList = (label: string, items: string[]) =>
    items.length ? `${label}:\n${items.map((item) => `- ${item}`).join("\n")}` : `${label}: [none]`;
  return [
    `Overall goal: ${snapshot.overallGoal ?? "[none]"}`,
    `Current focus: ${snapshot.currentFocus ?? "[none]"}`,
    formatList("Next actions", snapshot.nextActions),
    formatList("Blockers", snapshot.blockers),
    formatList("Notes", snapshot.notes),
  ].join("\n");
}

function hasContent(snapshot: WorkpadSnapshot): boolean {
  return snapshot.overallGoal !== null || snapshot.currentFocus !== null || snapshot.nextActions.length > 0 || snapshot.blockers.length > 0 || snapshot.notes.length > 0;
}

function blockNew(snapshot: WorkpadSnapshot): string {
  return `Your own working scratchpad — steering state for this session, not a record, and not a message from the user. Do not restate or acknowledge it; act on it. Re-derive facts from the conversation and tools rather than treating notes as ground truth.\nCurrent until replaced or cleared.\n\n${formatFields(snapshot)}`;
}

function blockOld(snapshot: WorkpadSnapshot): string {
  return `Your own working scratchpad — steering state for this session, not a record. Re-derive facts from the conversation and tools rather than treating notes as ground truth.\nCurrent until replaced or cleared. ${TOOL_NAME_GUIDANCE}\n\n${formatFields(snapshot)}`;
}

const FRAMING = (process.env.G1_FRAMING || "NEW").toUpperCase();
const DEBUG_DUMP = process.env.G1_DEBUG_DUMP || "";

// The injected block is request-local and never persisted, so the session log cannot show which
// arm ran. This records, per LLM request, exactly what went out. It writes nothing to `messages`.
function dump(record: Record<string, unknown>): void {
  if (!DEBUG_DUMP) return;
  try {
    appendFileSync(DEBUG_DUMP, `${JSON.stringify({ ts: Date.now(), framing: FRAMING, ...record })}\n`);
  } catch {
    // Measurement plumbing must never break the arm under test.
  }
}

export default function g1Fixture(pi: ExtensionAPI): void {
  let snapshot = emptySnapshot();
  const reconstruct = (ctx: ExtensionContext) => {
    snapshot = reconstructSnapshot(ctx);
  };
  pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));

  const guidelines =
    FRAMING === "OLD"
      ? [STALE_STATE_GUIDANCE, LIST_GUIDANCE, EVIDENCE_TAG_GUIDANCE, DURABILITY_GUIDANCE]
      : [STALE_STATE_GUIDANCE, RECALL_GUIDANCE, LIST_GUIDANCE, EVIDENCE_TAG_GUIDANCE, DURABILITY_GUIDANCE];

  pi.registerTool<typeof WorkpadParameters, WorkpadDetails>({
    name: WORKPAD_TOOL_NAME,
    label: "Mini self-org workpad",
    description: WORKPAD_DESCRIPTION,
    promptGuidelines: guidelines,
    parameters: WorkpadParameters,
    async execute(_toolCallId, params) {
      const next = sanitizeSnapshot(params);
      if (!next) {
        return { content: [{ type: "text", text: "Mini self-org workpad update rejected." }], details: {} as WorkpadDetails, isError: true };
      }
      snapshot = next;
      return {
        content: [{ type: "text", text: hasContent(snapshot) ? "Mini self-org workpad updated." : "Mini self-org workpad cleared. No context will be injected." }],
        details: { snapshot: { ...snapshot, nextActions: [...snapshot.nextActions], blockers: [...snapshot.blockers], notes: [...snapshot.notes] } } as WorkpadDetails,
      };
    },
  });

  pi.registerTool<typeof HistoryParameters, Record<string, never>>({
    name: HISTORY_TOOL_NAME,
    label: "Mini self-org focus history",
    description: HISTORY_DESCRIPTION,
    parameters: HistoryParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const history = reconstructHistory(ctx, params.limit);
      return { content: [{ type: "text", text: formatFocusHistory(history) }], details: {} as Record<string, never> };
    },
  });

  // Registered in every arm, including OFF, so OFF is proven by a recorded zero-byte request
  // rather than by the absence of a log line that might be missing for other reasons.
  pi.on("context", async (event) => {
    const messages = event.messages.filter(
      (message) => message.role !== "custom" || message.customType !== WORKPAD_CUSTOM_TYPE,
    );
    const before = event.messages.length;
    if (FRAMING === "OFF") {
      dump({ pushed: false, blockBytes: 0, messagesBefore: before });
      return { messages };
    }
    if (hasContent(snapshot)) {
      const content = FRAMING === "OLD" ? blockOld(snapshot) : blockNew(snapshot);
      dump({ pushed: true, blockBytes: Buffer.byteLength(content), messagesBefore: before, content });
      messages.push({
        role: "custom",
        customType: WORKPAD_CUSTOM_TYPE,
        content,
        display: false,
        timestamp: Date.now(),
      });
    } else {
      dump({ pushed: false, blockBytes: 0, messagesBefore: before });
    }
    return { messages };
  });
}
