import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import miniSelfOrg, { emptySnapshot, formatFocusHistory, reconstructHistory } from "../src/mini-self-org.js";

const TOOL_NAME = "mini-self-org-workpad";
type Handler = (event: any, ctx: any) => Promise<any>;

function setup() {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const pi = {
    on: vi.fn((name: string, handler: Handler) => handlers.set(name, handler)),
    registerTool: vi.fn((definition) => tools.set(definition.name, definition)),
    registerCommand: vi.fn((name, definition) => commands.set(name, { name, ...definition })),
  } as unknown as ExtensionAPI;
  miniSelfOrg(pi);
  return { handlers, tool: tools.get(TOOL_NAME), tools, commands, pi };
}

const context = (entries: unknown[] = []) => ({ sessionManager: { getBranch: () => entries } });
const workpadEntry = (toolName: string, snapshot: unknown, timestamp = 0) => ({
  type: "message",
  message: { role: "toolResult", toolName, details: { snapshot }, timestamp },
});
const valid = { goal: " Ship ", nextActions: [" Test "], blockers: [], notes: [" Keep small "] };

describe("miniSelfOrg", () => {
  it("registers the renamed tool and stale-state guidance", () => {
    const { tool, commands } = setup();
    expect(tool.name).toBe(TOOL_NAME);
    expect(tool.label).toBe("Mini self-org workpad");
    expect(tool.description).toContain("mini-self-org-workpad");
    expect(tool.description).toMatch(/workpad alone is not registered and must never be called as a tool/i);
    expect(tool.description).toContain('{ goal: "…", nextActions: ["…"], blockers: [], notes: [] }');
    expect(tool.description).toContain("lists are arrays, not JSON-encoded strings");
    expect(tool.description).toContain("replace the complete snapshot before the next consequential tool/action batch");
    expect(tool.description).toContain("Do not update ritualistically after every tool");
    expect(tool.promptGuidelines).toEqual(expect.arrayContaining([expect.stringContaining("Do not merely state that it is stale"), expect.stringContaining("mini-self-org-workpad"), expect.stringMatching(/workpad alone is not registered and must never be called as a tool/i)]));
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
    const jsonEncodedLists = await tool.execute("id", { ...valid, nextActions: '["Test"]', blockers: "[]", notes: "[]" });
    expect(jsonEncodedLists.isError).toBe(true);
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
      content: "Session-local, non-authoritative mini-self-org workpad.\nCurrent until replaced or cleared. The only registered mini-self-org tools are mini-self-org-workpad and mini-self-org-history; workpad alone is not registered and must never be called as a tool.\n\nGoal: Ship\nNext actions: - Test\nBlockers: [none]\nNotes: - Keep small",
    });
    expect(result.messages[1].content).toContain("mini-self-org-workpad");
    expect(result.messages[1].content).toMatch(/workpad alone is not registered and must never be called as a tool/i);
  });

  it("reconstructs focus history: forward walk, dedupe, change markers, cleared entries", () => {
    const A = { goal: "Ship", nextActions: ["a1"], blockers: [], notes: [] };
    const B = { goal: "Ship", nextActions: ["a2"], blockers: ["b"], notes: [] };
    const cleared = emptySnapshot();
    const A2 = { goal: "Back to A", nextActions: [], blockers: [], notes: ["n"] };
    const entries = [
      workpadEntry("workpad", A),
      workpadEntry(TOOL_NAME, A),
      workpadEntry(TOOL_NAME, B),
      workpadEntry(TOOL_NAME, cleared),
      workpadEntry(TOOL_NAME, { ...A2, nextActions: undefined }),
      workpadEntry(TOOL_NAME, A2),
    ];
    const history = reconstructHistory(context(entries));
    expect(history.total).toBe(5);
    expect(history.entries).toHaveLength(4);
    expect(history.entries[0]).toEqual({ timestamp: 0, snapshot: A, changed: [] });
    expect(history.entries[1].changed).toEqual(["nextActions", "blockers"]);
    expect(history.entries[2].snapshot).toEqual(cleared);
    expect(history.entries[3].changed).toEqual(["goal", "notes"]);
  });

  it("caps history at the requested limit and clamps out-of-range limits", () => {
    const entries = Array.from({ length: 20 }, (_, i) => workpadEntry(TOOL_NAME, { goal: `Goal ${i}`, nextActions: [], blockers: [], notes: [] }));
    expect(reconstructHistory(context(entries)).entries).toHaveLength(10);
    expect(reconstructHistory(context(entries)).entries[0].snapshot.goal).toBe("Goal 10");
    expect(reconstructHistory(context(entries), 3).entries[0].snapshot.goal).toBe("Goal 17");
    expect(reconstructHistory(context(entries), 100).entries).toHaveLength(15);
    expect(reconstructHistory(context(entries), 15).entries[0].snapshot.goal).toBe("Goal 5");
  });

  it("returns an empty history without ids when the branch has no workpad results", () => {
    const history = reconstructHistory(context([{ type: "message", message: { role: "toolResult", toolName: "read", details: undefined } }]));
    expect(history).toEqual({ total: 0, entries: [] });
    expect(JSON.stringify(history)).not.toMatch(/mso-wp|wp-\d/);
  });

  it("formats focus history newest last with cleared entries, clocks, and no id column", () => {
    const entries = [
      workpadEntry("workpad", { goal: "First", nextActions: [], blockers: [], notes: [] }, 1_700_000_000_000),
      workpadEntry(TOOL_NAME, emptySnapshot()),
    ];
    const text = formatFocusHistory(reconstructHistory(context(entries)));
    expect(text.split("\n")[0]).toBe("Focus history (branch-local, newest last) — 2 of 2, non-authoritative:");
    expect(text.split("\n")[1]).toMatch(/^\[\d{2}:\d{2}\] start: First$/);
    expect(text.split("\n")[2]).toBe("[--:--] — cleared —");
    expect(formatFocusHistory(reconstructHistory(context([])))).toBe("No focus history yet — this branch has no mini-self-org-workpad updates.");
  });

  it("returns the canonical empty snapshot", () => {
    expect(emptySnapshot()).toEqual({ goal: null, nextActions: [], blockers: [], notes: [] });
  });

  it("registers a read-only mini-self-org-history tool with re-orientation guidance", () => {
    const { tool, tools } = setup();
    const history = tools.get("mini-self-org-history");
    expect(history.label).toBe("Mini self-org focus history");
    expect(history.description).toContain("non-authoritative");
    expect(history.description).toContain("focus history");
    expect(history.description).toContain("after context compaction");
    expect(history.description).toContain("before clearing");
    expect(history.description).toContain("before starting a \"new\" goal");
    expect(history.description).toContain("cascade into sub-tasks");
    expect(history.promptGuidelines).toEqual(expect.arrayContaining([expect.stringContaining("after context compaction")]));
    expect(history.parameters.properties.limit.description).toContain("1-15");
    expect(tool.description).toContain("read via mini-self-org-history");
  });

  it("validates history parameters through the TypeBox compiler", () => {
    const { tools } = setup();
    const compiler = TypeCompiler.Compile(tools.get("mini-self-org-history").parameters);
    expect(compiler.Check({})).toBe(true);
    expect(compiler.Check({ limit: 3 })).toBe(true);
    expect(compiler.Check({ limit: 0 })).toBe(false);
    expect(compiler.Check({ limit: 16 })).toBe(false);
    expect(compiler.Check({ limit: 1.5 })).toBe(false);
  });

  it("serves focus history from the tool context and never mutates the current snapshot", async () => {
    const { tool, tools } = setup();
    const history = tools.get("mini-self-org-history");
    const entries = [workpadEntry(TOOL_NAME, valid), workpadEntry(TOOL_NAME, emptySnapshot())];
    const result = await history.execute("id", {}, undefined, undefined, context(entries));
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("start: Ship");
    expect(result.content[0].text).toContain("— cleared —");
    expect(result.details).toEqual({});
    const limited = await history.execute("id", { limit: 1 }, undefined, undefined, context(entries));
    expect(limited.content[0].text).toContain("— 1 of 2, non-authoritative:");
    expect(limited.content[0].text).toContain("— cleared —");
    const update = await tool.execute("id", valid);
    expect(update.details.snapshot).toEqual({ goal: "Ship", nextActions: ["Test"], blockers: [], notes: ["Keep small"] });
  });

  it("notifies the focused branch history from the /mini-self-org-history command", async () => {
    const { commands } = setup();
    const entries = [workpadEntry("workpad", { goal: "Command goal", nextActions: [], blockers: [], notes: [] })];
    const notify = vi.fn();
    await commands.get("mini-self-org-history").handler("", { ui: { notify }, sessionManager: { getBranch: () => entries } });
    expect(notify.mock.calls[0][0]).toContain("Command goal");
    expect(notify.mock.calls[0][0]).toContain("non-authoritative");
    expect(notify.mock.calls[0][1]).toBe("info");
  });

});
