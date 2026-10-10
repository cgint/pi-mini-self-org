import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

const WORKPAD_CUSTOM_TYPE = "mini-self-org-workpad";
const WORKPAD_TOOL_NAME = "self-org-workpad-set";
export const WORKPAD_GET_TOOL_NAME = "self-org-workpad-get";
const HISTORICAL_WORKPAD_TOOL_NAME = "mini-self-org-workpad";
const LEGACY_WORKPAD_TOOL_NAME = "workpad";
const HISTORY_TOOL_NAME = "self-org-workpad-history";
const WORKPAD_WRITE_TOOL_NAMES = [WORKPAD_TOOL_NAME, HISTORICAL_WORKPAD_TOOL_NAME, LEGACY_WORKPAD_TOOL_NAME];
export const USER_PIN_CUSTOM_TYPE = "mini-self-org-user-pin";
const MAX_USER_DIRECTIVE_LENGTH = 300;
const HISTORY_DEFAULT_LIMIT = 10;
const HISTORY_MAX_LIMIT = 15;
const MAX_OVERALL_GOAL_LENGTH = 500;
const MAX_CURRENT_FOCUS_LENGTH = 500;
const MAX_ITEM_LENGTH = 500;
export const MAX_ITEMS = 5;
export const MAX_BLOCKERS = 3;
const MEMORY_BOUNDARY_GUIDANCE = "Use self-org-workpad-set for higher-level goals and durable steering (the compass). Write intent (what you aim to achieve), not cursor status. Detailed investigation, logs, and volatile findings belong in files on disk (the working memory); retain at most one durable working memory pointer in notes (e.g. [verified] Working memory: docs/investigation.md). Do not copy details already available in the conversation or tool results; re-derive those when needed.";
const LIST_GUIDANCE = "Keep self-org-workpad-set lists to 1–3 items typically (max 5).";
const EVIDENCE_TAG_GUIDANCE = "In self-org-workpad-set, use [unverified], [verified], or [research] as confidence labels on notes and blockers; they label steering items, not an evidence log.";
const TOOL_NAME_GUIDANCE = "The only registered mini-self-org tools are self-org-workpad-set, self-org-workpad-get, and self-org-workpad-history; workpad alone is not registered and must never be called as a tool.";
const RECALL_GUIDANCE = "The self-org-workpad-set workpad sheets are persisted into the conversation history at turn boundaries and are your own recalled state, not user input: never acknowledge, restate, or quote them — use them to steer your next action.";
const HISTORY_USAGE_GUIDANCE = `Call self-org-workpad-history to re-orient after context compaction, after long interruptions, before clearing the workpad, or before starting a new work thread. It is read-only and non-authoritative: it shows this branch's overall-goal and focus history (past workpad snapshots) and never replaces a self-org-workpad-set update.`;
const STALE_STATE_GUIDANCE = `When your overall goal, current focus, plan, or blockers materially change, call self-org-workpad-set to replace the complete snapshot before the next consequential tool/action batch — not after every tool result. ${TOOL_NAME_GUIDANCE} Do not merely state that it is stale; replace it. Do not update ritualistically after every tool; use meaningful state boundaries.`;

interface InjectionPolicy {
  userBoundary: boolean;
  scheduledInterval?: number;
}

function parseInjectionPolicy(value = process.env.MINI_SELF_ORG_INJECTION): InjectionPolicy {
  if (value === "always") {
    console.warn("MINI_SELF_ORG_INJECTION=always is no longer supported: use scheduled:1 for per-turn or scheduled:N for per-N-turns. Falling back to never.");
    return { userBoundary: false };
  }
  if (value === undefined || value === "" || value === "never" || value === "off") return { userBoundary: false };
  // "a+b" is the composite form: "user-boundary" plus a scheduled interval (history-scheduled:<N>
  // is a silent alias of scheduled:<N>, also usable as a composite token).
  const compositeMatch =
    /^user-boundary\+((?:history-)?scheduled):([1-9]\d*)$|^((?:history-)?scheduled):([1-9]\d*)\+user-boundary$/.exec(value);
  if (compositeMatch) {
    const interval = Number(compositeMatch[2] ?? compositeMatch[4]);
    if (Number.isSafeInteger(interval)) return { userBoundary: true, scheduledInterval: interval };
  }
  if (value === "user-boundary") return { userBoundary: true };
  // history-scheduled:<N> is a silent alias for scheduled:<N> (lossless rename).
  const scheduledMatch = /^(?:scheduled|history-scheduled):([1-9]\d*)$/.exec(value);
  if (scheduledMatch) {
    const interval = Number(scheduledMatch[1]);
    if (Number.isSafeInteger(interval)) return { userBoundary: false, scheduledInterval: interval };
  }
  throw new Error("MINI_SELF_ORG_INJECTION must be never, off, user-boundary, scheduled:<N>, history-scheduled:<N> (aliased to scheduled:<N>), or user-boundary+scheduled:<N> (order-independent)");
}

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

export interface UserDirective {
  text: string;
  timestamp: number;
}

export const WorkpadParameters = Type.Object({
  overallGoal: Type.Union([Type.String({ maxLength: MAX_OVERALL_GOAL_LENGTH }), Type.Null()], {
    description: "Stable, high-level outcome for the active session-local work thread; null when absent.",
  }),
  currentFocus: Type.Union([Type.String({ maxLength: MAX_CURRENT_FOCUS_LENGTH }), Type.Null()], {
    description: "Current strategic focus within the overall goal, not the latest command, tool result, or status observation; null when absent.",
  }),
  nextActions: Type.Array(Type.String({ maxLength: MAX_ITEM_LENGTH }), {
    maxItems: MAX_ITEMS,
    description: "A few high-level upcoming moves, not a tool-by-tool checklist or task log.",
  }),
  blockers: Type.Array(Type.String({ maxLength: MAX_ITEM_LENGTH }), {
    maxItems: MAX_BLOCKERS,
    description: "Durable constraints that block progress; exclude transient command failures and status observations.",
  }),
  notes: Type.Array(Type.String({ maxLength: MAX_ITEM_LENGTH }), {
    maxItems: MAX_ITEMS,
    description: "Durable hypotheses, decisions, and constraints needed after compaction; exclude logs, tool output, versions, and rediscoverable findings.",
  }),
});

export const WorkpadGetParameters = Type.Object({});

export const HistoryParameters = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: HISTORY_MAX_LIMIT, description: "Number of recent entries to show (1-15, default 10)." })),
});

export const emptySnapshot = (): WorkpadSnapshot => ({ overallGoal: null, currentFocus: null, nextActions: [], blockers: [], notes: [] });

function sanitizeText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maximumLength ? text : undefined;
}

export function validateSnapshot(value: unknown): { ok: true; snapshot: WorkpadSnapshot } | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "arguments must be a JSON object" };
  }
  const candidate = value as Record<string, unknown>;

  const hasCurrentFields =
    Object.prototype.hasOwnProperty.call(candidate, "overallGoal") ||
    Object.prototype.hasOwnProperty.call(candidate, "currentFocus");

  let overallGoal: string | null = null;
  let currentFocus: string | null = null;

  if (hasCurrentFields) {
    if (candidate.overallGoal === undefined) {
      return { ok: false, reason: "overallGoal is required (pass a string or null)" };
    }
    if (candidate.overallGoal !== null && typeof candidate.overallGoal !== "string") {
      return { ok: false, reason: "overallGoal must be a string or null" };
    }
    if (typeof candidate.overallGoal === "string") {
      const trimmed = candidate.overallGoal.trim();
      if (trimmed.length > MAX_OVERALL_GOAL_LENGTH) {
        return { ok: false, reason: `overallGoal exceeds maximum length of ${MAX_OVERALL_GOAL_LENGTH} characters (${trimmed.length} chars received)` };
      }
      overallGoal = trimmed.length === 0 ? null : trimmed;
    }

    if (candidate.currentFocus === undefined) {
      return { ok: false, reason: "currentFocus is required (pass a string or null)" };
    }
    if (candidate.currentFocus !== null && typeof candidate.currentFocus !== "string") {
      return { ok: false, reason: "currentFocus must be a string or null" };
    }
    if (typeof candidate.currentFocus === "string") {
      const trimmed = candidate.currentFocus.trim();
      if (trimmed.length > MAX_CURRENT_FOCUS_LENGTH) {
        return { ok: false, reason: `currentFocus exceeds maximum length of ${MAX_CURRENT_FOCUS_LENGTH} characters (${trimmed.length} chars received)` };
      }
      currentFocus = trimmed.length === 0 ? null : trimmed;
    }
  } else {
    if (candidate.goal === undefined) {
      return { ok: false, reason: "overallGoal and currentFocus are required" };
    }
    if (candidate.goal !== null && typeof candidate.goal !== "string") {
      return { ok: false, reason: "goal must be a string or null" };
    }
    if (typeof candidate.goal === "string") {
      const trimmed = candidate.goal.trim();
      if (trimmed.length > MAX_CURRENT_FOCUS_LENGTH) {
        return { ok: false, reason: `goal exceeds maximum length of ${MAX_CURRENT_FOCUS_LENGTH} characters (${trimmed.length} chars received)` };
      }
      currentFocus = trimmed.length === 0 ? null : trimmed;
    }
  }

  const validateFieldList = (
    key: "nextActions" | "blockers" | "notes",
    maxItems: number,
  ): { ok: true; list: string[] } | { ok: false; reason: string } => {
    const list = candidate[key];
    if (!Array.isArray(list)) {
      return { ok: false, reason: `${key} must be an array of strings, not ${typeof list}` };
    }
    if (list.length > maxItems) {
      return { ok: false, reason: `${key} has ${list.length} items; max is ${maxItems}` };
    }
    const sanitized: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (typeof item !== "string") {
        return { ok: false, reason: `${key}[${i}] must be a string` };
      }
      const trimmed = item.trim();
      if (trimmed.length === 0) {
        continue;
      }
      if (trimmed.length > MAX_ITEM_LENGTH) {
        return { ok: false, reason: `${key}[${i}] exceeds maximum length of ${MAX_ITEM_LENGTH} characters (${trimmed.length} chars received)` };
      }
      sanitized.push(trimmed);
    }
    return { ok: true, list: sanitized };
  };

  const nextActionsRes = validateFieldList("nextActions", MAX_ITEMS);
  if (!nextActionsRes.ok) return nextActionsRes;

  const blockersRes = validateFieldList("blockers", MAX_BLOCKERS);
  if (!blockersRes.ok) return blockersRes;

  const notesRes = validateFieldList("notes", MAX_ITEMS);
  if (!notesRes.ok) return notesRes;

  return {
    ok: true,
    snapshot: {
      overallGoal,
      currentFocus,
      nextActions: nextActionsRes.list,
      blockers: blockersRes.list,
      notes: notesRes.list,
    },
  };
}

/** Returns a detached, sanitized current snapshot, or migrates a legacy goal to currentFocus without inventing an overallGoal. */
export function sanitizeSnapshot(value: unknown): WorkpadSnapshot | undefined {
  const result = validateSnapshot(value);
  return result.ok ? result.snapshot : undefined;
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
    if (message?.role !== "toolResult" || !WORKPAD_WRITE_TOOL_NAMES.includes(message.toolName ?? "")) continue;
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
interface CustomMessageEntry {
  type?: string;
  customType?: string;
  details?: { snapshot?: unknown };
}

/**
 * Reads the branch for the newest WORKPAD_CUSTOM_TYPE custom_message entry
 * and returns its details.snapshot, or null if none exists.
 * Used for reconstruction on reload/branch-switch (§4.5).
 */
export function reconstructLastPersisted(ctx: BranchSource): WorkpadSnapshot | null {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as CustomMessageEntry | undefined;
    if (entry?.type !== "custom_message" || entry.customType !== WORKPAD_CUSTOM_TYPE) continue;
    const snapshot = sanitizeSnapshot(entry.details?.snapshot);
    if (snapshot) return snapshot;
  }
  return null;
}

export function reconstructHistory(ctx: BranchSource, limit = HISTORY_DEFAULT_LIMIT): FocusHistory {
  const branch = ctx.sessionManager.getBranch();
  let total = 0;
  const entries: FocusHistoryEntry[] = [];
  for (const raw of branch) {
    const entry = raw as WorkpadResultEntry | undefined;
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (message?.role !== "toolResult" || !WORKPAD_WRITE_TOOL_NAMES.includes(message.toolName ?? "")) continue;
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
  if (history.entries.length === 0) return "No focus history yet — this branch has no self-org-workpad-set updates.";
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

export const USER_GUARDRAIL_DELIMITER = "────────────────────────────────────────────────────────────";
export const INJECTION_GUARDRAIL_DELIMITER = "════════════════════════════════════════════════════════════";

export function formatWorkpad(snapshot: WorkpadSnapshot, directive: UserDirective | null = null): string {
  if (!directive) {
    return `Mini self-org workpad\n${formatFields(snapshot)}`;
  }
  const indentedText = directive.text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  const directiveBlock = [
    USER_GUARDRAIL_DELIMITER,
    "USER STANDING GUARDRAIL (Human-owned, non-negotiable):",
    indentedText,
    USER_GUARDRAIL_DELIMITER,
  ].join("\n");
  const fields = hasContent(snapshot) ? `[Agent scratchpad]\n${formatFields(snapshot)}` : formatFields(snapshot);
  return `Mini self-org workpad\n\n${directiveBlock}\n\n${fields}`;
}

/** Reads the branch's newest USER_PIN_CUSTOM_TYPE entry (any text, including null/cleared); sanitizes defensively. */
export function reconstructUserDirective(ctx: BranchSource): UserDirective | null {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as { type?: string; customType?: string; data?: { text?: unknown; timestamp?: unknown } } | undefined;
    if (entry?.type !== "custom" || entry.customType !== USER_PIN_CUSTOM_TYPE) continue;
    const raw = entry.data;
    if (raw?.text === null || raw?.text === undefined) return null;
    const text = sanitizeText(raw.text, MAX_USER_DIRECTIVE_LENGTH);
    if (text === undefined) return null;
    const timestamp = typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp) ? raw.timestamp : 0;
    return { text, timestamp };
  }
  return null;
}

function hasContent(snapshot: WorkpadSnapshot): boolean {
  return snapshot.overallGoal !== null || snapshot.currentFocus !== null || snapshot.nextActions.length > 0 || snapshot.blockers.length > 0 || snapshot.notes.length > 0;
}

/** Serializes only the steering content (pin text + workpad fields) for change detection. Deliberately excludes the turn index and compaction flag, which change on every tick and would defeat the "only when it changed" gate. */
function steeringContentKey(snapshot: WorkpadSnapshot, directive: UserDirective | null): string {
  return JSON.stringify([directive?.text ?? null, snapshot.overallGoal, snapshot.currentFocus, snapshot.nextActions, snapshot.blockers, snapshot.notes]);
}

const NOTICE_MAX_FIELD_CHARS = 30;
const NOTICE_MAX_TOTAL_CHARS = 70;
const NOTICE_SEPARATOR = " \u00B7 ";
const NOTICE_ELLIPSIS = "\u2026";

/** Truncates a single field value to a short, glance-able form for the TUI notice line. */
function truncateForNotice(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= NOTICE_MAX_FIELD_CHARS ? trimmed : `${trimmed.slice(0, NOTICE_MAX_FIELD_CHARS - 1)}${NOTICE_ELLIPSIS}`;
}

/** Code-point length (not UTF-16 units) so CJK / emoji do not mis-measure the notice width. */
function noticeLength(value: string): number {
  return [...value].length;
}

/** Pluralized list count, e.g. "1 action" / "2 actions"; returns null when the list is empty. */
function countLabel(items: string[], singular: string, plural: string): string | null {
  if (items.length === 0) return null;
  return items.length === 1 ? `1 ${singular}` : `${items.length} ${plural}`;
}

/** Builds the one-line, TUI-only steering notice: a short human note of what the agent now carries.
 *  Fields are added in priority order (pin > goal > focus > list counts) and lower-priority fields
 *  are dropped once the total would exceed NOTICE_MAX_TOTAL_CHARS, so the notice stays a single line.
 *  The pin (a human guardrail) always leads. Returns "workpad cleared" when nothing is present. */
function steeringNoticeText(snapshot: WorkpadSnapshot, directive: UserDirective | null): string {
  const fields: string[] = [];
  if (directive?.text) fields.push(`pin \u201C${truncateForNotice(directive.text)}\u201D`);
  if (snapshot.overallGoal) fields.push(`goal \u201C${truncateForNotice(snapshot.overallGoal)}\u201D`);
  if (snapshot.currentFocus) fields.push(`focus \u201C${truncateForNotice(snapshot.currentFocus)}\u201D`);
  const actionLabel = countLabel(snapshot.nextActions, "action", "actions");
  if (actionLabel) fields.push(actionLabel);
  const blockerLabel = countLabel(snapshot.blockers, "blocker", "blockers");
  if (blockerLabel) fields.push(blockerLabel);
  if (fields.length === 0) return "workpad cleared";
  // Greedily keep the highest-priority fields that fit within the total-length budget.
  let result = fields[0];
  for (let i = 1; i < fields.length; i += 1) {
    const candidate = `${result}${NOTICE_SEPARATOR}${fields[i]}`;
    if (noticeLength(candidate) <= NOTICE_MAX_TOTAL_CHARS) {
      result = candidate;
    } else {
      break;
    }
  }
  return result;
}

/** Renders the periodic empty-workpad nudge sheet (scheduled mode): reminds the agent to set steering state. Carries no snapshot payload. */
function emptyNudgeBody(turnIndex: number, postCompaction = false): string {
  const header = postCompaction
    ? `Mini self-org workpad — checkpoint (turn ${turnIndex}, post-compaction): the workpad is empty.`
    : `Mini self-org workpad — checkpoint (turn ${turnIndex}): the workpad is empty.`;
  const lines = [
    header,
    "Periodic reminder: if this session has a sustained objective, set steering state via self-org-workpad-set (overallGoal, currentFocus, nextActions, blockers, notes). One-off requests can stay empty.",
  ];
  if (postCompaction) {
    lines.push("Context was recently compacted. Review or set your steering state, or inspect past focus via self-org-workpad-history.");
  }
  lines.push("Do not acknowledge this reminder.");
  return lines.join("\n");
}

/** Renders the passive history checkpoint sheet body (R2 self-ownership phrasing, Q3 verbatim lines). */
function historySheetBody(
  snapshot: WorkpadSnapshot,
  turnIndex: number,
  directive: UserDirective | null = null,
  postCompaction = false,
): string {
  const header = postCompaction
    ? `Mini self-org workpad — history checkpoint (turn ${turnIndex}, post-compaction)`
    : `Mini self-org workpad — history checkpoint (turn ${turnIndex})`;
  const directiveBlock = directive
    ? [
        INJECTION_GUARDRAIL_DELIMITER,
        "STANDING USER GUARDRAIL (Human-owned, supreme invariant):",
        ...directive.text.split("\n").map((line) => `  ${line}`),
        "Operational rule: Supreme invariant. Precedes and bounds all goals, plans, and actions below. Never violate or negotiate this. Adhere silently without acknowledging or restating it.",
        INJECTION_GUARDRAIL_DELIMITER,
        "",
        "[AGENT WORKING STATE] (Your own scratchpad, set via self-org-workpad-set):",
      ].join("\n")
    : "";
  const framing = directive
    ? "Framing: Never acknowledge, restate, or quote this block back to the user; use both sections silently to steer your execution."
    : "This is your own workpad state (set via self-org-workpad-set); never acknowledge, restate, or quote this block back to the user.";
  const lines = [
    header,
    directiveBlock,
    framing,
    `Turn index: ${turnIndex}`,
  ];
  if (postCompaction) {
    lines.push("Context was recently compacted. Review your compass above; if strategic orientation was lost, inspect your focus history via self-org-workpad-history.");
  }
  lines.push(
    "Later tool activity may supersede this; authoritative state is maintained via the workpad tool.",
    hasContent(snapshot) ? formatFields(snapshot) : "The agent's scratchpad is currently empty.",
  );
  return lines.filter((line): line is string => line !== "").join("\n");
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
  const injectionPolicy = parseInjectionPolicy();
  let snapshot = emptySnapshot();
  let turnsSinceLastAppend = 0;
  let forceNextAppend = false;
  let isPostCompaction = false;
  let sessionTurnCount = 0;
  let userDirective: UserDirective | null = null;
  // TUI-only notice dedup: remembers the steering content last injected, so a one-line
  // steering notice shows only when the content actually changed (not every tick).
  // Seeded in reconstruct (session_start/session_tree) so a resume or branch-switch that
  // re-injects identical content stays quiet — the notice is for genuine changes, not reloads.
  // Not persisted to the branch, so it is pure session-view state.
  let lastInjectedContentKey = "";
  // Whether the last injected steering state actually had content (pad or pin). Used so a
  // transition to empty (clearing the workpad or unpinning) can show a distinct "cleared"
  // one-line — symmetric with the add/change case.
  let lastHadSteeringContent = false;
  // Persistent user-boundary trigger: armed by before_agent_start, consumed by turn_end.
  let pendingUserBoundary = false;
  const anyPersistentTrigger = () => injectionPolicy.userBoundary || injectionPolicy.scheduledInterval !== undefined;
  const reconstruct = (ctx: ExtensionContext) => {
    snapshot = reconstructSnapshot(ctx);
    userDirective = reconstructUserDirective(ctx);
    isPostCompaction = false;
    if (injectionPolicy.scheduledInterval !== undefined) {
      turnsSinceLastAppend = 0;
    }
    if (anyPersistentTrigger()) {
      // Session-cumulative turn count (Q3 marker integrity): continue from the number of
      // persisted history sheets already in the branch, so multi-invocation sessions do not
      // restart the counter at 0.
      sessionTurnCount = ctx.sessionManager.getBranch().filter((entry) => {
        const item = entry as { type?: string; customType?: string } | undefined;
        return item?.type === "custom_message" && item.customType === WORKPAD_CUSTOM_TYPE;
      }).length;
      // D3: a resume/branch-switch is a boundary crossing. Set forceNextAppend so the
      // first completed turn after resume appends a sheet (any persistent trigger).
      // Reproduces legacy semantics (old code set forceNextInjection=true in reconstruct).
      forceNextAppend = true;
    }
    // Seed the notice dedup with the reconstructed content so a reload/branch-switch that
    // re-injects the same steering state does NOT show a spurious steering notice.
    lastInjectedContentKey = steeringContentKey(snapshot, userDirective);
    lastHadSteeringContent = hasContent(snapshot) || userDirective !== null;
  };
  pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));
  pi.on("before_agent_start", async () => {
    if (injectionPolicy.userBoundary) {
      pendingUserBoundary = true;
    }
  });
  pi.on("session_compact", async () => {
    forceNextAppend = true;
    isPostCompaction = true;
  });
  // Passive history append: every N completed turns (scheduled) or on the first completed turn
  // after each user-submitted agent loop (user-boundary), re-append the workpad state as a
  // custom_message entry (R1 recall). Re-appends regardless of change; no `continue` (D2).
  pi.on("turn_end", (event, ctx) => {
    if (event.outcome !== "completed") return undefined;
    if (!injectionPolicy.userBoundary && injectionPolicy.scheduledInterval === undefined) return undefined;
    // Q3 marker: increment whenever any persistent trigger is enabled, so every sheet
    // carries a turn index regardless of the enabled combination. Cost: nil.
    sessionTurnCount += 1;
    // The scheduled window ticks on EVERY completed turn — including empty-workpad turns —
    // so a later-populated pad appends on the normal cadence, and an empty pad gets a nudge
    // sheet at the same boundary (LLM self-org nudge).
    if (injectionPolicy.scheduledInterval !== undefined) {
      turnsSinceLastAppend += 1;
    }
    const boundaryDue = injectionPolicy.userBoundary && pendingUserBoundary;
    const forceAppend = forceNextAppend;
    const scheduledDue =
      injectionPolicy.scheduledInterval !== undefined &&
      (turnsSinceLastAppend >= injectionPolicy.scheduledInterval || forceAppend);
    const postCompaction = forceAppend && isPostCompaction;
    // Coalesce at most one sheet per turn; a boundary-only sheet never resets the
    // scheduled cadence, so composition keeps both triggers' standalone meaning.
    // The user directive rides the same cadence: with a directive active and an empty
    // pad, a due turn emits the unified sheet (not the nudge) and consumes all triggers.
    if ((hasContent(snapshot) || userDirective !== null) && (boundaryDue || scheduledDue || forceAppend)) {
      pendingUserBoundary = false;
      forceNextAppend = false;
      isPostCompaction = false;
      if (scheduledDue) turnsSinceLastAppend = 0;
      // TUI-only, content-gated one-line: visible to the human, never reaches the agent (ui.notify
      // is a pure UI call, not a message). Fires only when the steering content actually changed.
      const contentKey = steeringContentKey(snapshot, userDirective);
      if (contentKey !== lastInjectedContentKey) {
        lastInjectedContentKey = contentKey;
        // ui.notify is a pure UI call (never reaches the agent): it routes to the TUI status
        // line in interactive mode, an RPC event in rpc mode, and a no-op in no-UI mode.
        // The optional chain is defensive: pi guarantees a non-null ui, but a missing ui must
        // never break the (essential) sheet injection — the notice is a side effect only.
        ctx.ui?.notify?.(steeringNoticeText(snapshot, userDirective), "info");
      }
      lastHadSteeringContent = hasContent(snapshot) || userDirective !== null;
      return {
        entries: [{
          type: "custom_message",
          customType: WORKPAD_CUSTOM_TYPE,
          content: historySheetBody(snapshot, sessionTurnCount, userDirective, postCompaction),
          display: false,
          details: hasContent(snapshot)
            ? { snapshot: { ...snapshot, nextActions: [...snapshot.nextActions], blockers: [...snapshot.blockers], notes: [...snapshot.notes] } }
            : {},
        }],
      };
    }
    // Empty pad, no directive: a due scheduled window or force consumes a nudge sheet;
    // a boundary-only due keeps the boundary (and force) pending so a later non-empty
    // turn can emit it.
    if (scheduledDue) {
      forceNextAppend = false;
      isPostCompaction = false;
      turnsSinceLastAppend = 0;
      // Clear/unpin notice: if the previously injected steering state had content and it is now
      // empty (workpad cleared and/or pin removed), show a distinct one-line so losing a guardrail
      // is not silent. The nudge sheet itself is still injected to the agent; this is TUI-only.
      if (lastHadSteeringContent) {
        lastHadSteeringContent = false;
        lastInjectedContentKey = steeringContentKey(snapshot, userDirective);
        ctx.ui?.notify?.(steeringNoticeText(snapshot, userDirective), "info");
      }
      return {
        entries: [{
          type: "custom_message",
          customType: WORKPAD_CUSTOM_TYPE,
          content: emptyNudgeBody(sessionTurnCount, postCompaction),
          display: false,
          details: {},
        }],
      };
    }
    return undefined;
  });

  pi.registerTool<typeof WorkpadParameters, WorkpadDetails>({
    name: WORKPAD_TOOL_NAME,
    label: "Mini self-org workpad",
    description: `${MEMORY_BOUNDARY_GUIDANCE} It is your own session scratchpad; the human seeing it is a side effect, not the audience. Call self-org-workpad-set at meaningful state boundaries during substantive work. ${TOOL_NAME_GUIDANCE} Valid shape: { overallGoal: "…", currentFocus: "…", nextActions: ["…"], blockers: [], notes: [] }; lists are arrays, not JSON-encoded strings. ${LIST_GUIDANCE} ${EVIDENCE_TAG_GUIDANCE} The tool holds only the current snapshot; past snapshots can be read via self-org-workpad-history. ${STALE_STATE_GUIDANCE} Set currentFocus to null to clear only the focus while retaining overallGoal. Clear every field only when the workpad no longer aids the current session. Do not use it for project memory, evidence logs, approved plans, or task tracking.`,
    promptGuidelines: [MEMORY_BOUNDARY_GUIDANCE, STALE_STATE_GUIDANCE, RECALL_GUIDANCE, LIST_GUIDANCE, EVIDENCE_TAG_GUIDANCE],
    parameters: WorkpadParameters,
    async execute(_toolCallId, params) {
      const validation = validateSnapshot(params);
      if (!validation.ok) {
        return { content: [{ type: "text", text: `Mini self-org workpad update rejected: ${validation.reason}.` }], details: {} as WorkpadDetails, isError: true };
      }
      snapshot = validation.snapshot;
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

  pi.registerTool<typeof WorkpadGetParameters, Record<string, never>>({
    name: WORKPAD_GET_TOOL_NAME,
    label: "Mini self-org workpad (read)",
    description: "Read the current session-local workpad snapshot. Read-only: performs no writes. Call it to re-orient when the auto-injected workpad block is not present or you need to confirm current state. Returns the same five fields as a write would store.",
    promptGuidelines: [],
    parameters: WorkpadGetParameters,
    async execute(_toolCallId, _params) {
      return { content: [{ type: "text", text: formatWorkpad(snapshot, userDirective) }], details: {} as Record<string, never> };
    },
    renderResult(result, _options, _theme, _context) {
      const text = (result.content ?? []).map((content) => (content.type === "text" ? content.text ?? "" : "")).join("\n");
      return {
        render: (width) => truncateLines(text.split("\n"), width),
        invalidate: () => {},
      };
    },
  });

  pi.registerTool<typeof HistoryParameters, Record<string, never>>({
    name: HISTORY_TOOL_NAME,
    label: "Mini self-org focus history",
    description: `Read the session-local focus history: a bounded, newest-last timeline of this branch's past self-org-workpad-set snapshots (timestamps, which fields changed, cleared states). A non-authoritative memory aid — not task tracking, and never a replacement for re-deriving from evidence. It distinguishes each work thread's overall goal from its current focus. Call it deliberately: after context compaction, after long interruptions, before clearing the workpad, or before starting a new work thread, to re-orient to the overall goal. Read-only: it performs no writes.`,
    promptGuidelines: [HISTORY_USAGE_GUIDANCE],
    parameters: HistoryParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const history = reconstructHistory(ctx, params.limit);
      return { content: [{ type: "text", text: formatFocusHistory(history) }], details: {} as Record<string, never> };
    },
  });

  pi.registerCommand("mini-self-org", {
    description: "Show the current read-only session-local workpad.",
    handler: async (args, ctx) => {
      if (args.trim().length > 0) {
        ctx.ui.notify("Usage: /mini-self-org — use /mini-self-org-user-pin <text> or /mini-self-org-user-unpin for directives.", "error");
        return;
      }
      ctx.ui.notify(formatWorkpad(snapshot, userDirective), "info");
    },
  });
  pi.registerCommand("mini-self-org-user-pin", {
    description: "Set or replace the user-pinned directive for this session.",
    handler: async (args, ctx) => {
      let text: string | undefined = args.trim();
      if (text.length === 0 && ctx.hasUI) {
        text = (await ctx.ui.input("Pin a directive:", "A standing guardrail for this session"))?.trim();
      }
      if (text === undefined || text.length === 0) {
        ctx.ui.notify(args.trim().length === 0 && !ctx.hasUI ? "Usage: /mini-self-org-user-pin <text> — argument required, no interactive UI available." : "Nothing to pin: provide non-empty text.", "error");
        return;
      }
      if (text.length > MAX_USER_DIRECTIVE_LENGTH) {
        ctx.ui.notify(`Pin rejected: directive exceeds the ${MAX_USER_DIRECTIVE_LENGTH}-character limit.`, "error");
        return;
      }
      const timestamp = Date.now();
      pi.appendEntry(USER_PIN_CUSTOM_TYPE, { text, timestamp });
      userDirective = { text, timestamp };
      if (anyPersistentTrigger()) forceNextAppend = true;
      ctx.ui.notify(formatWorkpad(snapshot, userDirective), "info");
    },
  });
  pi.registerCommand("mini-self-org-user-pin-submit", {
    description: "Set the user-pinned directive AND immediately submit it as a user message to trigger an agent turn.",
    handler: async (args, ctx) => {
      let text: string | undefined = args.trim();
      if (text.length === 0 && ctx.hasUI) {
        text = (await ctx.ui.input("Pin & submit directive:", "A standing guardrail — will be submitted immediately"))?.trim();
      }
      if (text === undefined || text.length === 0) {
        ctx.ui.notify(args.trim().length === 0 && !ctx.hasUI ? "Usage: /mini-self-org-user-pin-submit <text> — argument required, no interactive UI available." : "Nothing to pin: provide non-empty text.", "error");
        return;
      }
      if (text.length > MAX_USER_DIRECTIVE_LENGTH) {
        ctx.ui.notify(`Pin rejected: directive exceeds the ${MAX_USER_DIRECTIVE_LENGTH}-character limit.`, "error");
        return;
      }
      const timestamp = Date.now();
      pi.appendEntry(USER_PIN_CUSTOM_TYPE, { text, timestamp });
      userDirective = { text, timestamp };
      if (anyPersistentTrigger()) forceNextAppend = true;
      ctx.ui.notify(formatWorkpad(snapshot, userDirective), "info");
      if (ctx.isIdle()) {
        await pi.sendUserMessage(text, { expandPromptTemplates: false });
      } else {
        await pi.sendUserMessage(text, { deliverAs: "followUp", expandPromptTemplates: false });
      }
    },
  });
  pi.registerCommand("mini-self-org-user-unpin", {
    description: "Clear the user-pinned directive for this session.",
    handler: async (args, ctx) => {
      if (args.trim().length > 0) {
        ctx.ui.notify("Usage: /mini-self-org-user-unpin", "error");
        return;
      }
      const timestamp = Date.now();
      pi.appendEntry(USER_PIN_CUSTOM_TYPE, { text: null, timestamp });
      userDirective = null;
      if (anyPersistentTrigger()) forceNextAppend = true;
      ctx.ui.notify(formatWorkpad(snapshot, userDirective), "info");
    },
  });
  pi.registerCommand("mini-self-org-history", {
    description: "Show the read-only session-local focus history (past workpad snapshots).",
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatFocusHistory(reconstructHistory(ctx)), "info");
    },
  });
  // Strip-only: remove any WORKPAD_CUSTOM_TYPE custom messages from the LLM request. No
  // injection path — the turn_end persistent append is the sole injection mechanism (F8:
  // persisted history sheets are projected as role "user", so this filter never touches them).
  pi.on("context", async (event) => {
    return {
      messages: event.messages.filter(
        (message) => message.role !== "custom" || message.customType !== WORKPAD_CUSTOM_TYPE,
      ),
    };
  });
}
