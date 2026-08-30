import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import miniSelfOrg, { emptySnapshot } from "../src/mini-self-org.js";

const TOOL_NAME = "mini-self-org-workpad";
type Handler = (event: any, ctx: any) => Promise<any>;

function setup(force = false) {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const pi = {
    on: vi.fn((name: string, handler: Handler) => handlers.set(name, handler)),
    registerTool: vi.fn((definition) => tools.set(definition.name, definition)),
    registerCommand: vi.fn((name, definition) => commands.set(name, { name, ...definition })),
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => force),
  } as unknown as ExtensionAPI;
  miniSelfOrg(pi);
  return { handlers, tool: tools.get(TOOL_NAME), commands, pi };
}

const context = (entries: unknown[] = []) => ({ sessionManager: { getBranch: () => entries } });
const workpadEntry = (toolName: string, snapshot: unknown) => ({
  type: "message",
  message: { role: "toolResult", toolName, details: { snapshot } },
});
const valid = { goal: " Ship ", nextActions: [" Test "], blockers: [], notes: [" Keep small "] };
const workpadResult = (details: unknown, isError = false) => ({ toolName: TOOL_NAME, details, isError });
const actionResult = () => ({ toolName: "read", details: undefined, isError: false });

describe("miniSelfOrg", () => {
  it("registers the renamed tool and stale-state guidance", () => {
    const { pi, tool, commands } = setup();
    expect((pi as any).registerFlag).toHaveBeenCalledWith("mini-self-org-force", expect.objectContaining({ type: "boolean", default: false }));
    expect((pi as any).getFlag).toHaveBeenCalledWith("mini-self-org-force");
    expect(tool.name).toBe(TOOL_NAME);
    expect(tool.label).toBe("Mini self-org workpad");
    expect(tool.description).toContain("replace the complete snapshot before the next consequential tool/action batch");
    expect(tool.description).toContain("Do not update ritualistically after every tool");
    expect(tool.promptGuidelines).toEqual(expect.arrayContaining([expect.stringContaining("Do not merely state that it is stale")]));
    expect(commands.get("mini-self-org").description).toContain("read-only");
  });

  it("returns compact model content and renders the full normalized snapshot from details", async () => {
    const { tool, commands } = setup();
    const success = await tool.execute("id", valid);
    expect(success.isError).toBeUndefined();
    expect(success.content[0].text).toBe("Mini self-org workpad updated.");
    expect(success.content[0].text).not.toContain("Goal:");
    expect(success.details.snapshot).toEqual({ goal: "Ship", nextActions: ["Test"], blockers: [], notes: ["Keep small"] });
    const component = tool.renderResult(success, {}, {}, {});
    expect(component.invalidate).toEqual(expect.any(Function));
    expect(component.render(80)).toEqual([
      "Updated — active until replaced or cleared",
      "",
      "Goal: Ship",
      "Next actions: - Test",
      "Blockers: [none]",
      "Notes: - Keep small",
    ]);

    const rejected = await tool.execute("id", { ...valid, blockers: ["a", "b", "c"] });
    expect(rejected.isError).toBe(true);
    const notify = vi.fn();
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    expect(notify).toHaveBeenCalledWith("Mini self-org workpad\nGoal: Ship\nNext actions: - Test\nBlockers: [none]\nNotes: - Keep small", "info");
  });

  it("clearly renders and reports clearing", async () => {
    const { tool } = setup();
    const cleared = await tool.execute("id", { goal: null, nextActions: [], blockers: [], notes: [] });
    expect(cleared.content[0].text).toBe("Mini self-org workpad cleared. No context will be injected.");
    expect(cleared.details.snapshot).toEqual(emptySnapshot());
    const component = tool.renderResult(cleared, {}, {}, {});
    expect(component.invalidate).toEqual(expect.any(Function));
    expect(component.render(80)).toEqual(["Cleared — no context will be injected."]);
  });

  it("truncates every structural render line to the supplied width", async () => {
    const { tool } = setup();
    const width = 12;
    const updated = await tool.execute("id", {
      goal: "An overlong goal that must fit the terminal",
      nextActions: ["An overlong list item that must fit the terminal"],
      blockers: [],
      notes: [],
    });
    const cleared = await tool.execute("id", emptySnapshot());

    for (const component of [tool.renderResult(updated, {}, {}, {}), tool.renderResult(cleared, {}, {}, {})]) {
      expect(component.render(width).every((line: string) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("reconstructs the last valid snapshot from legacy and current tool results", async () => {
    const { handlers, commands } = setup();
    const legacy = { goal: "Legacy", nextActions: [], blockers: [], notes: [] };
    const current = { goal: "Current", nextActions: ["Do it"], blockers: [], notes: [] };
    await handlers.get("session_start")?.({}, context([workpadEntry("workpad", legacy), workpadEntry(TOOL_NAME, current)]));
    const notify = vi.fn();
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    expect(notify.mock.calls[0][0]).toContain("Goal: Current");

    await handlers.get("session_tree")?.({}, context([workpadEntry("workpad", legacy)]));
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    expect(notify.mock.calls[1][0]).toContain("Goal: Legacy");
  });

  it("injects exactly one canonical current context block only when non-empty", async () => {
    const { handlers } = setup();
    const contextHandler = handlers.get("context");
    const existing = { role: "custom", customType: TOOL_NAME, content: "old", display: false, timestamp: 1 };
    const user = { role: "user", content: "keep", timestamp: 1 };
    expect(await contextHandler?.({ messages: [user, existing] }, context())).toEqual({ messages: [user] });

    await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, valid)]));
    const result = (await contextHandler?.({ messages: [user, existing] }, context())) as { messages: any[] };
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      role: "custom",
      customType: TOOL_NAME,
      display: false,
      content: "Session-local, non-authoritative mini-self-org workpad.\nCurrent until replaced or cleared.\n\nGoal: Ship\nNext actions: - Test\nBlockers: [none]\nNotes: - Keep small",
    });
    expect(result.messages[1].content.match(/workpad/g)).toHaveLength(1);
  });

  it("starts force mode from the flag and recognizes the current tool name", async () => {
    const { handlers } = setup(true);
    const blocked = await handlers.get("tool_call")?.({ toolName: "read" }, context());
    expect(blocked).toEqual({ block: true, reason: expect.stringContaining("workpad alone first") });
    expect(await handlers.get("tool_call")?.({ toolName: TOOL_NAME }, context())).toBeUndefined();
    expect(await handlers.get("tool_call")?.({ toolName: "workpad" }, context())).toMatchObject({ block: true });
    const guidance = await handlers.get("before_agent_start")?.({ systemPrompt: "base" }, context());
    expect(guidance.systemPrompt).toContain("gate applies to tool use");
    expect(guidance.systemPrompt).toMatch(/text-only responses cannot be mechanically blocked/i);
  });

  it("clears only after a valid successful current-tool result and makes it due after actions", async () => {
    const { handlers } = setup(true);
    const toolCall = handlers.get("tool_call")!;
    const toolResult = handlers.get("tool_result")!;
    expect(await toolCall({ toolName: "read" }, context())).toMatchObject({ block: true });
    expect(await toolCall({ toolName: TOOL_NAME }, context())).toBeUndefined();
    // Sibling calls are preflighted before the workpad result event, so this action remains blocked.
    expect(await toolCall({ toolName: "read" }, context())).toMatchObject({ block: true });
    await toolResult(workpadResult({}, true), context());
    expect(await toolCall({ toolName: "read" }, context())).toMatchObject({ block: true });
    await toolResult(workpadResult({ snapshot: valid }), context());
    expect(await toolCall({ toolName: "read" }, context())).toBeUndefined();
    await toolResult(actionResult(), context());
    expect(await toolCall({ toolName: "read" }, context())).toMatchObject({ block: true });
  });

  it("returns the canonical empty snapshot", () => {
    expect(emptySnapshot()).toEqual({ goal: null, nextActions: [], blockers: [], notes: [] });
  });

  it("toggles force mode for the session and force-off never blocks", async () => {
    const { handlers, commands } = setup();
    const notify = vi.fn();
    await commands.get("mini-self-org-force-on").handler("", { ui: { notify } });
    expect(notify).toHaveBeenLastCalledWith("Mini self-org force mode on; a workpad refresh is due.", "info");
    expect(await handlers.get("tool_call")?.({ toolName: "read" }, context())).toMatchObject({ block: true });
    await commands.get("mini-self-org-force-off").handler("", { ui: { notify } });
    expect(notify).toHaveBeenLastCalledWith("Mini self-org force mode off; tool calls are not blocked.", "info");
    expect(await handlers.get("tool_call")?.({ toolName: "read" }, context())).toBeUndefined();
  });
});
