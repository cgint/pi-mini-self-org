import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

const WORKPAD_CUSTOM_TYPE = "mini-self-org-workpad";
const WORKPAD_TOOL_NAME = "mini-self-org-workpad";
const LEGACY_WORKPAD_TOOL_NAME = "workpad";
const HISTORY_TOOL_NAME = "mini-self-org-history";
const HISTORY_DEFAULT_LIMIT = 10;
const HISTORY_MAX_LIMIT = 15;
const MAX_OVERALL_GOAL_LENGTH = 500;
const MAX_CURRENT_FOCUS_LENGTH = 500;
const MAX_ITEM_LENGTH = 300;
export const MAX_ITEMS = 5;
const LIST_GUIDANCE = "Lists: 1–3 items typical (max 5).";
const EVIDENCE_TAG_GUIDANCE = "For notes and blockers, use [unverified], [verified], or [research] when the evidence status matters.";
const TOOL_NAME_GUIDANCE = "The only registered mini-self-org tools are mini-self-org-workpad and mini-self-org-history; workpad alone is not registered and must never be called as a tool.";
const HISTORY_USAGE_GUIDANCE = `Call mini-self-org-history to re-orient after context compaction, after long interruptions, before clearing the workpad, or before starting a new work thread. It is read-only and non-authoritative: it shows this branch's overall-goal and focus history (past workpad snapshots) and never replaces a mini-self-org-workpad update.`;
const STALE_STATE_GUIDANCE = `When you determine the current workpad no longer reflects the overall goal, current focus, material evidence, next actions, blockers, or notes, call mini-self-org-workpad to replace the complete snapshot before the next consequential tool/action batch. ${TOOL_NAME_GUIDANCE} Do not merely state that it is stale. Do not update ritualistically after every tool; use meaningful state boundaries.`;

export interface WorkpadSnapshot {
  /** Stable umbrella outcome for the active session-local work thread. */
  overallGoal: string | null;
  /** Immediate bounded activity within that work thread. */
  currentFocus: string | null;
  nextActions: string[];
  blockers: string[];
  notes: string[];
}

interface WorkpadDetails {
  snapshot?: WorkpadSnapshot;
}

export const WorkpadParameters = Type.Object({
  overallGoal: Type.Union([Type.String({ minLength: 1, maxLength: MAX_OVERALL_GOAL_LENGTH }), Type.Null()]),
  currentFocus: Type.Union([Type.String({ minLength: 1, maxLength: MAX_CURRENT_FOCUS_LENGTH }), Type.Null()]),
  nextActions: Type.Array(Type.String({ minLength: 1, maxLength: MAX_ITEM_LENGTH }), { maxItems: MAX_ITEMS }),
  blockers: Type.Array(Type.String({ minLength: 1, maxLength: MAX_ITEM_LENGTH }), { maxItems: 2 }),
  notes: Type.Array(Type.String({ minLength: 1, maxLength: MAX_ITEM_LENGTH }), { maxItems: MAX_ITEMS }),
});

export const HistoryParameters = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: HISTORY_MAX_LIMIT, description: "Number of recent entries to show (1-15, default 10)." })),
});

export const emptySnapshot = (): WorkpadSnapshot => ({ overallGoal: null, currentFocus: null, nextActions: [], blockers: [], notes: [] });

function sanitizeText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maximumLength ? text : undefined;
}

function sanitizeNullableText(value: unknown, maximumLength: number): string | null | undefined {
  return value === null ? null : sanitizeText(value, maximumLength);
}

function sanitizeList(value: unknown, maximumItems: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const items = value.map((item) => sanitizeText(item, MAX_ITEM_LENGTH));
  return items.every((item): item is string => item !== undefined) ? items : undefined;
}

/** Returns a detached, sanitized current snapshot, or migrates a legacy goal to currentFocus without inventing an overallGoal. */
export function sanitizeSnapshot(value: unknown): WorkpadSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const nextActions = sanitizeList(candidate.nextActions, MAX_ITEMS);
  const blockers = sanitizeList(candidate.blockers, 2);
  const notes = sanitizeList(candidate.notes, MAX_ITEMS);
  if (!nextActions || !blockers || !notes) return undefined;

  const hasCurrentFields = Object.prototype.hasOwnProperty.call(candidate, "overallGoal") || Object.prototype.hasOwnProperty.call(candidate, "currentFocus");
  if (hasCurrentFields) {
    const overallGoal = sanitizeNullableText(candidate.overallGoal, MAX_OVERALL_GOAL_LENGTH);
    const currentFocus = sanitizeNullableText(candidate.currentFocus, MAX_CURRENT_FOCUS_LENGTH);
    return overallGoal !== undefined && currentFocus !== undefined ? { overallGoal, currentFocus, nextActions, blockers, notes } : undefined;
  }

  const legacyGoal = sanitizeNullableText(candidate.goal, MAX_CURRENT_FOCUS_LENGTH);
  if (legacyGoal === undefined) return undefined;
  return { overallGoal: null, currentFocus: legacyGoal, nextActions, blockers, notes };
}

/** Minimal read-only branch access needed by reconstruction; avoids coupling to the full ExtensionContext. */
export interface BranchSource {
  sessionManager: {
    getBranch(): readonly unknown[];
  };
}

interface WorkpadResultEntry {
  type?: string;
  message?: {
    role?: string;
    toolName?: string;
    timestamp?: number;
    details?: { snapshot?: unknown };
  };
}

export function reconstructSnapshot(ctx: BranchSource): WorkpadSnapshot {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as WorkpadResultEntry | undefined;
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (message?.role !== "toolResult" || ![WORKPAD_TOOL_NAME, LEGACY_WORKPAD_TOOL_NAME].includes(message.toolName ?? "")) continue;
    const snapshot = sanitizeSnapshot(message.details?.snapshot);
    if (snapshot) return snapshot;
  }
  return emptySnapshot();
}

export type WorkpadField = keyof WorkpadSnapshot;

export interface FocusHistoryEntry {
  timestamp: number;
  snapshot: WorkpadSnapshot;
  changed: WorkpadField[];
}

export interface FocusHistory {
  total: number;
  entries: FocusHistoryEntry[];
}

function sameList(previous: string[], next: string[]): boolean {
  return previous.length === next.length && previous.every((item, index) => item === next[index]);
}

function sameSnapshot(previous: WorkpadSnapshot, next: WorkpadSnapshot): boolean {
  return previous.overallGoal === next.overallGoal && previous.currentFocus === next.currentFocus && sameList(previous.nextActions, next.nextActions) && sameList(previous.blockers, next.blockers) && sameList(previous.notes, next.notes);
}

function changedFields(previous: WorkpadSnapshot, next: WorkpadSnapshot): WorkpadField[] {
  const changed: WorkpadField[] = [];
  if (previous.overallGoal !== next.overallGoal) changed.push("overallGoal");
  if (previous.currentFocus !== next.currentFocus) changed.push("currentFocus");
  if (!sameList(previous.nextActions, next.nextActions)) changed.push("nextActions");
  if (!sameList(previous.blockers, next.blockers)) changed.push("blockers");
  if (!sameList(previous.notes, next.notes)) changed.push("notes");
  return changed;
}

function formatClock(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "--:--";
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Reconstructs the branch's focus history: sanitized workpad snapshots in branch order, consecutive duplicates merged, capped to the newest `limit` entries. */
export function reconstructHistory(ctx: BranchSource, limit = HISTORY_DEFAULT_LIMIT): FocusHistory {
  const branch = ctx.sessionManager.getBranch();
  let total = 0;
  const entries: FocusHistoryEntry[] = [];
  for (const raw of branch) {
    const entry = raw as WorkpadResultEntry | undefined;
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (message?.role !== "toolResult" || ![WORKPAD_TOOL_NAME, LEGACY_WORKPAD_TOOL_NAME].includes(message.toolName ?? "")) continue;
    const snapshot = sanitizeSnapshot(message.details?.snapshot);
    if (!snapshot) continue;
    total += 1;
    const previous = entries[entries.length - 1];
    if (previous && sameSnapshot(previous.snapshot, snapshot)) continue;
    entries.push({ timestamp: message.timestamp ?? 0, snapshot, changed: previous ? changedFields(previous.snapshot, snapshot) : [] });
  }
  const size = Math.min(Math.max(Math.trunc(limit) || HISTORY_DEFAULT_LIMIT, 1), HISTORY_MAX_LIMIT);
  return { total, entries: entries.slice(-size) };
}

/** Renders a focus history as a bounded, newest-last, non-authoritative timeline. */
export function formatFocusHistory(history: FocusHistory): string {
  if (history.entries.length === 0) return "No focus history yet — this branch has no mini-self-org-workpad updates.";
  const lines = [`Focus history (branch-local, newest last) — ${history.entries.length} of ${history.total}, non-authoritative:`];
  history.entries.forEach((entry, index) => {
    const clock = formatClock(entry.timestamp);
    const overallGoal = entry.snapshot.overallGoal ?? "(no overall goal)";
    const currentFocus = entry.snapshot.currentFocus ?? "(no current focus)";
    lines.push(hasContent(entry.snapshot) ? `[${clock}] ${index === 0 ? "start" : entry.changed.join("+")}: Overall goal: ${overallGoal}; Current focus: ${currentFocus}` : `[${clock}] — cleared —`);
  });
  return lines.join("\n");
}

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

export function formatWorkpad(snapshot: WorkpadSnapshot): string {
  return `Mini self-org workpad\n${formatFields(snapshot)}`;
}

function hasContent(snapshot: WorkpadSnapshot): boolean {
  return snapshot.overallGoal !== null || snapshot.currentFocus !== null || snapshot.nextActions.length > 0 || snapshot.blockers.length > 0 || snapshot.notes.length > 0;
}

function contextMessage(snapshot: WorkpadSnapshot): string {
  return `Session-local, non-authoritative mini-self-org workpad.\nCurrent until replaced or cleared. ${TOOL_NAME_GUIDANCE}\n\n${formatFields(snapshot)}`;
}

interface StructuralComponent {
  render(width: number): string[];
  invalidate(): void;
}

function truncateLines(lines: string[], width: number): string[] {
  return lines.map((line) => (width > 0 && visibleWidth(line) <= width ? line : truncateToWidth(line, width)));
}

function renderSnapshot(snapshot: WorkpadSnapshot): StructuralComponent {
  return {
    render: (width) => truncateLines(["Updated — active until replaced or cleared", "", ...formatFields(snapshot).split("\n")], width),
    invalidate: () => {},
  };
}

function renderCleared(): StructuralComponent {
  return {
    render: (width) => truncateLines(["Cleared — no context will be injected."], width),
    invalidate: () => {},
  };
}

function renderRejected(result: AgentToolResult<WorkpadDetails>): StructuralComponent {
  const text = (result.content ?? []).map((content) => (content.type === "text" ? content.text ?? "" : "")).join("\n");
  const detail =
    text.split("\n").find((line) => line.trim().startsWith("- ")) ??
    text.split("\n").find((line) => line.trim().length > 0);
  const lines = ["Rejected — workpad unchanged (previous state still active)."];
  if (detail) lines.push(detail.trim());
  return {
    render: (width) => truncateLines(lines, width),
    invalidate: () => {},
  };
}

/** Registers the session-local workpad tool and its read-only command. */
export default function miniSelfOrg(pi: ExtensionAPI): void {
  let snapshot = emptySnapshot();
  const reconstruct = (ctx: ExtensionContext) => {
    snapshot = reconstructSnapshot(ctx);
  };
  pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));

  pi.registerTool<typeof WorkpadParameters, WorkpadDetails>({
    name: WORKPAD_TOOL_NAME,
    label: "Mini self-org workpad",
    description: `Call mini-self-org-workpad proactively throughout substantive work. ${TOOL_NAME_GUIDANCE} Valid shape: { overallGoal: "…", currentFocus: "…", nextActions: ["…"], blockers: [], notes: [] }; lists are arrays, not JSON-encoded strings. ${LIST_GUIDANCE} ${EVIDENCE_TAG_GUIDANCE} overallGoal is the stable umbrella outcome for the current session-local work thread; currentFocus is the immediate bounded activity. Replace the complete snapshot whenever either field, next actions, blockers, or notes change. The tool holds only the current snapshot; past snapshots can be read via mini-self-org-history. ${STALE_STATE_GUIDANCE} Set currentFocus to null to clear only the focus while retaining overallGoal. Clear every field only when the workpad no longer aids the current session. Do not use it for project memory, evidence, approved plans, or task tracking.`,
    promptGuidelines: [STALE_STATE_GUIDANCE, LIST_GUIDANCE, EVIDENCE_TAG_GUIDANCE],
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
    renderResult(result, _options, _theme, context) {
      if (context.isError) return renderRejected(result);
      const resultSnapshot = sanitizeSnapshot((result.details as WorkpadDetails | undefined)?.snapshot);
      return resultSnapshot && hasContent(resultSnapshot) ? renderSnapshot(resultSnapshot) : renderCleared();
    },
  });

  pi.registerTool<typeof HistoryParameters, Record<string, never>>({
    name: HISTORY_TOOL_NAME,
    label: "Mini self-org focus history",
    description: `Read the session-local focus history: a bounded, newest-last timeline of this branch's past mini-self-org-workpad snapshots (timestamps, which fields changed, cleared states). A non-authoritative memory aid — not task tracking, and never a replacement for re-deriving from evidence. It distinguishes each work thread's overall goal from its current focus. Call it deliberately: after context compaction, after long interruptions, before clearing the workpad, or before starting a new work thread, to re-orient to the overall goal. Read-only: it performs no writes.`,
    promptGuidelines: [HISTORY_USAGE_GUIDANCE],
    parameters: HistoryParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const history = reconstructHistory(ctx, params.limit);
      return { content: [{ type: "text", text: formatFocusHistory(history) }], details: {} as Record<string, never> };
    },
  });

  pi.registerCommand("mini-self-org", {
    description: "Show the current read-only session-local workpad.",
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatWorkpad(snapshot), "info");
    },
  });
  pi.registerCommand("mini-self-org-history", {
    description: "Show the read-only session-local focus history (past workpad snapshots).",
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatFocusHistory(reconstructHistory(ctx)), "info");
    },
  });
  // Before each LLM call, inject a final transient, non-authoritative workpad block; it is request-local, not persisted in custom session history.
  pi.on("context", async (event) => {
    const messages = event.messages.filter(
      (message) => message.role !== "custom" || message.customType !== WORKPAD_CUSTOM_TYPE,
    );
    if (hasContent(snapshot)) {
      messages.push({
        role: "custom",
        customType: WORKPAD_CUSTOM_TYPE,
        content: contextMessage(snapshot),
        display: false,
        timestamp: Date.now(),
      });
    }
    return { messages };
  });
}
