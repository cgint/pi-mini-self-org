import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

const WORKPAD_CUSTOM_TYPE = "mini-self-org-workpad";
const WORKPAD_TOOL_NAME = "mini-self-org-workpad";
const LEGACY_WORKPAD_TOOL_NAME = "workpad";
const MAX_GOAL_LENGTH = 500;
const MAX_ITEM_LENGTH = 300;
const FORCE_MODE_GUIDANCE = "Mini self-org force mode is on: this gate applies to tool use. A successful workpad refresh is due before any non-workpad tool call; call workpad alone first, then make later action calls. Text-only responses cannot be mechanically blocked by Pi's supported API.";
const FORCE_MODE_BLOCK_REASON = "Mini self-org force mode requires a successful workpad refresh before other tools. Call workpad alone first, then make the action call in a later response.";
const STALE_STATE_GUIDANCE = "When you determine the current workpad no longer reflects material evidence, goal, next actions, blockers, or notes, replace the complete snapshot before the next consequential tool/action batch. Do not merely state that it is stale. Do not update ritualistically after every tool; use meaningful state boundaries.";

export interface WorkpadSnapshot {
  goal: string | null;
  nextActions: string[];
  blockers: string[];
  notes: string[];
}

interface WorkpadDetails {
  snapshot?: WorkpadSnapshot;
}

export const WorkpadParameters = Type.Object({
  goal: Type.Union([Type.String({ minLength: 1, maxLength: MAX_GOAL_LENGTH }), Type.Null()]),
  nextActions: Type.Array(Type.String({ minLength: 1, maxLength: MAX_ITEM_LENGTH }), { maxItems: 3 }),
  blockers: Type.Array(Type.String({ minLength: 1, maxLength: MAX_ITEM_LENGTH }), { maxItems: 2 }),
  notes: Type.Array(Type.String({ minLength: 1, maxLength: MAX_ITEM_LENGTH }), { maxItems: 3 }),
});

export const emptySnapshot = (): WorkpadSnapshot => ({ goal: null, nextActions: [], blockers: [], notes: [] });

function sanitizeText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maximumLength ? text : undefined;
}

function sanitizeList(value: unknown, maximumItems: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const items = value.map((item) => sanitizeText(item, MAX_ITEM_LENGTH));
  return items.every((item): item is string => item !== undefined) ? items : undefined;
}

/** Returns a detached, sanitized snapshot, or undefined when the input is invalid. */
export function sanitizeSnapshot(value: unknown): WorkpadSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const goal = candidate.goal === null ? null : sanitizeText(candidate.goal, MAX_GOAL_LENGTH);
  const nextActions = sanitizeList(candidate.nextActions, 3);
  const blockers = sanitizeList(candidate.blockers, 2);
  const notes = sanitizeList(candidate.notes, 3);
  if (goal === undefined || !nextActions || !blockers || !notes) return undefined;
  return { goal, nextActions, blockers, notes };
}

export function reconstructSnapshot(ctx: ExtensionContext): WorkpadSnapshot {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "message" || entry.message.role !== "toolResult" || ![WORKPAD_TOOL_NAME, LEGACY_WORKPAD_TOOL_NAME].includes(entry.message.toolName)) continue;
    const details = entry.message.details as { snapshot?: unknown } | undefined;
    const snapshot = sanitizeSnapshot(details?.snapshot);
    if (snapshot) return snapshot;
  }
  return emptySnapshot();
}

function formatFields(snapshot: WorkpadSnapshot): string {
  const formatList = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "[none]");
  return [
    `Goal: ${snapshot.goal ?? "[none]"}`,
    `Next actions: ${formatList(snapshot.nextActions)}`,
    `Blockers: ${formatList(snapshot.blockers)}`,
    `Notes: ${formatList(snapshot.notes)}`,
  ].join("\n");
}

export function formatWorkpad(snapshot: WorkpadSnapshot): string {
  return `Mini self-org workpad\n${formatFields(snapshot)}`;
}

function hasContent(snapshot: WorkpadSnapshot): boolean {
  return snapshot.goal !== null || snapshot.nextActions.length > 0 || snapshot.blockers.length > 0 || snapshot.notes.length > 0;
}

function contextMessage(snapshot: WorkpadSnapshot): string {
  return `Session-local, non-authoritative mini-self-org workpad.\nCurrent until replaced or cleared.\n\n${formatFields(snapshot)}`;
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

/** Registers the session-local workpad tool and its read-only command. */
export default function miniSelfOrg(pi: ExtensionAPI): void {
  pi.registerFlag("mini-self-org-force", {
    description: "Require a successful workpad refresh before non-workpad tool calls.",
    type: "boolean",
    default: false,
  });

  let forceMode = pi.getFlag("mini-self-org-force") === true;
  let workpadDue = forceMode;
  let snapshot = emptySnapshot();
  const reconstruct = (ctx: ExtensionContext) => {
    snapshot = reconstructSnapshot(ctx);
  };
  const setForceMode = (enabled: boolean, ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }) => {
    forceMode = enabled;
    workpadDue = enabled;
    ctx.ui.notify(`Mini self-org force mode ${enabled ? "on; a workpad refresh is due." : "off; tool calls are not blocked."}`, "info");
  };

  pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));

  pi.registerTool<typeof WorkpadParameters, WorkpadDetails>({
    name: WORKPAD_TOOL_NAME,
    label: "Mini self-org workpad",
    description: `Use this workpad proactively throughout substantive work. Start it when beginning work that may develop beyond a single direct response; replace the complete snapshot whenever the goal, next actions, blockers, or notes change. ${STALE_STATE_GUIDANCE} Clear it only when it no longer aids the current session. Do not use it for project memory, evidence, approved plans, or task tracking.`,
    promptGuidelines: [STALE_STATE_GUIDANCE],
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
    renderResult(result) {
      const resultSnapshot = sanitizeSnapshot((result.details as WorkpadDetails | undefined)?.snapshot);
      return resultSnapshot && hasContent(resultSnapshot) ? renderSnapshot(resultSnapshot) : renderCleared();
    },
  });

  pi.registerCommand("mini-self-org", {
    description: "Show the current read-only session-local workpad.",
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatWorkpad(snapshot), "info");
    },
  });
  pi.registerCommand("mini-self-org-force-on", {
    description: "Require a workpad refresh before non-workpad tool calls for this session.",
    handler: async (_args, ctx) => setForceMode(true, ctx),
  });
  pi.registerCommand("mini-self-org-force-off", {
    description: "Stop requiring workpad refreshes before tool calls for this session.",
    handler: async (_args, ctx) => setForceMode(false, ctx),
  });

  pi.on("before_agent_start", async (event) => {
    if (!forceMode) return undefined;
    workpadDue = true;
    return { systemPrompt: `${event.systemPrompt}\n\n${FORCE_MODE_GUIDANCE}` };
  });

  pi.on("tool_call", async (event) => {
    if (forceMode && workpadDue && event.toolName !== WORKPAD_TOOL_NAME) {
      return { block: true, reason: FORCE_MODE_BLOCK_REASON };
    }
    return undefined;
  });

  pi.on("tool_result", async (event) => {
    if (!forceMode) return undefined;
    if (event.toolName !== WORKPAD_TOOL_NAME) {
      workpadDue = true;
      return undefined;
    }
    if (!event.isError && sanitizeSnapshot((event.details as WorkpadDetails | undefined)?.snapshot)) {
      workpadDue = false;
    }
    return undefined;
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
