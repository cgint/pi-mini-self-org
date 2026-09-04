import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import miniSelfOrg, { emptySnapshot, formatFocusHistory, reconstructHistory, reconstructSnapshot, sanitizeSnapshot, WorkpadParameters } from "../src/mini-self-org.js";

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
const valid = { overallGoal: " Ship ", currentFocus: " Test focus ", nextActions: [" Test "], blockers: [], notes: [" Keep small "] };

describe("miniSelfOrg", () => {
  it("separates overall goal from current focus and migrates legacy snapshots without inventing an overall goal", () => {
    const compiler = TypeCompiler.Compile(WorkpadParameters);
    const current = {
      overallGoal: "Deliver the study",
      currentFocus: "Verify citations",
      nextActions: ["Run checks"],
      blockers: [],
      notes: ["[verified] Sources present"],
    };
    const legacy = { goal: "Legacy tactical focus", nextActions: [], blockers: [], notes: [] };

    expect(compiler.Check(current)).toBe(true);
    expect(compiler.Check(legacy)).toBe(false);
    expect(reconstructSnapshot(context([workpadEntry("workpad", legacy)]))).toEqual({
      overallGoal: null,
      currentFocus: "Legacy tactical focus",
      nextActions: [],
      blockers: [],
      notes: [],
    });
    expect(sanitizeSnapshot({ overallGoal: "Partial current", goal: "Legacy fallback", nextActions: [], blockers: [], notes: [] })).toBeUndefined();
  });

  it("registers the renamed tool and stale-state guidance", () => {
    const { tool, commands } = setup();
    expect(tool.name).toBe(TOOL_NAME);
    expect(tool.label).toBe("Mini self-org workpad");
    expect(tool.description).toContain("mini-self-org-workpad");
    expect(tool.description).toMatch(/workpad alone is not registered and must never be called as a tool/i);
    expect(tool.description).toContain('{ overallGoal: "…", currentFocus: "…", nextActions: ["…"], blockers: [], notes: [] }');
    expect(tool.description).toContain("lists are arrays, not JSON-encoded strings");
    expect(tool.description).toContain("Lists: 1–3 items typical (max 5).");
    expect(tool.description).toContain("[unverified], [verified], or [research]");
    expect(tool.description).toContain("replace the complete snapshot before the next consequential tool/action batch");
    expect(tool.description).toContain("Do not update ritualistically after every tool");
    expect(tool.promptGuidelines).toEqual(expect.arrayContaining([expect.stringContaining("Do not merely state that it is stale"), expect.stringContaining("mini-self-org-workpad"), expect.stringMatching(/workpad alone is not registered and must never be called as a tool/i), "Lists: 1–3 items typical (max 5).", expect.stringContaining("[unverified], [verified], or [research]")]));
    expect(commands.get("mini-self-org").description).toContain("read-only");
  });

  it("returns compact model content and renders the full normalized snapshot from details", async () => {
    const { tool, commands } = setup();
    const success = await tool.execute("id", valid);
    expect(success.isError).toBeUndefined();
    expect(success.content[0].text).toBe("Mini self-org workpad updated.");
    expect(success.content[0].text).not.toContain("Goal:");
    expect(success.details.snapshot).toEqual({ overallGoal: "Ship", currentFocus: "Test focus", nextActions: ["Test"], blockers: [], notes: ["Keep small"] });
    const component = tool.renderResult(success, {}, {}, {});
    expect(component.invalidate).toEqual(expect.any(Function));
    expect(component.render(80)).toEqual([
      "Updated — active until replaced or cleared",
      "",
      "Overall goal: Ship",
      "Current focus: Test focus",
      "Next actions:",
      "- Test",
      "Blockers: [none]",
      "Notes:",
      "- Keep small",
    ]);

    const rejected = await tool.execute("id", { ...valid, blockers: ["a", "b", "c"] });
    expect(rejected.isError).toBe(true);
    const jsonEncodedLists = await tool.execute("id", { ...valid, nextActions: '["Test"]', blockers: "[]", notes: "[]" });
    expect(jsonEncodedLists.isError).toBe(true);
    const notify = vi.fn();
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    expect(notify).toHaveBeenCalledWith("Mini self-org workpad\nOverall goal: Ship\nCurrent focus: Test focus\nNext actions:\n- Test\nBlockers: [none]\nNotes:\n- Keep small", "info");
  });

  it("renders self-rejected workpad updates as rejected", async () => {
    const { tool } = setup();
    const rejected = await tool.execute("id", { ...valid, blockers: ["a", "b", "c"] });

    expect(rejected.isError).toBe(true);
    expect(tool.renderResult(rejected, {}, {}, { isError: true }).render(80)).toEqual([
      "Rejected — workpad unchanged (previous state still active).",
      "Mini self-org workpad update rejected.",
    ]);
  });

  it("renders harness validation failures as rejected with their error item", () => {
    const { tool } = setup();
    const rejected = {
      content: [{ type: "text", text: "Validation failed for tool \"mini-self-org-workpad\":\n  - nextActions.0: must be string\nReceived arguments: ..." }],
      details: {},
    };

    expect(tool.renderResult(rejected, {}, {}, { isError: true }).render(80)).toEqual([
      "Rejected — workpad unchanged (previous state still active).",
      "- nextActions.0: must be string",
    ]);
  });

  it("accepts and persists up to five next actions and notes, while schema and runtime reject six", async () => {
    const { tool } = setup();
    const compiler = TypeCompiler.Compile(WorkpadParameters);
    const items = Array.from({ length: 5 }, (_, index) => `item ${index + 1}`);
    const fourItems = { ...valid, nextActions: items.slice(0, 4), notes: items.slice(0, 4) };
    const fiveItems = { ...valid, nextActions: items, notes: items };

    expect(compiler.Check(fourItems)).toBe(true);
    expect(compiler.Check(fiveItems)).toBe(true);
    expect(compiler.Check({ ...fiveItems, nextActions: [...items, "item 6"] })).toBe(false);
    expect(compiler.Check({ ...fiveItems, notes: [...items, "item 6"] })).toBe(false);
    expect((await tool.execute("id", fiveItems)).details.snapshot).toEqual({ overallGoal: "Ship", currentFocus: "Test focus", nextActions: items, blockers: [], notes: items });
    expect((await tool.execute("id", { ...fiveItems, nextActions: [...items, "item 6"] })).isError).toBe(true);
    expect((await tool.execute("id", { ...fiveItems, notes: [...items, "item 6"] })).isError).toBe(true);
  });

  it("reconstructs a valid five-item snapshot without truncating it", async () => {
    const { handlers, commands } = setup();
    const items = Array.from({ length: 5 }, (_, index) => `item ${index + 1}`);
    await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, { overallGoal: "Five", currentFocus: "Check five", nextActions: items, blockers: [], notes: items })]));
    const notify = vi.fn();
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    expect(notify).toHaveBeenCalledWith("Mini self-org workpad\nOverall goal: Five\nCurrent focus: Check five\nNext actions:\n- item 1\n- item 2\n- item 3\n- item 4\n- item 5\nBlockers: [none]\nNotes:\n- item 1\n- item 2\n- item 3\n- item 4\n- item 5", "info");
  });

  it("clearly renders and reports clearing", async () => {
    const { tool } = setup();
    const cleared = await tool.execute("id", emptySnapshot());
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
      overallGoal: "An overlong overall goal that must fit the terminal",
      currentFocus: "An overlong current focus that must fit the terminal",
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
    const current = { overallGoal: "Current work thread", currentFocus: "Current", nextActions: ["Do it"], blockers: [], notes: [] };
    await handlers.get("session_start")?.({}, context([workpadEntry("workpad", legacy), workpadEntry(TOOL_NAME, current)]));
    const notify = vi.fn();
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    expect(notify.mock.calls[0][0]).toContain("Overall goal: Current work thread");
    expect(notify.mock.calls[0][0]).toContain("Current focus: Current");

    await handlers.get("session_tree")?.({}, context([workpadEntry("workpad", legacy)]));
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    expect(notify.mock.calls[1][0]).toContain("Overall goal: [none]");
    expect(notify.mock.calls[1][0]).toContain("Current focus: Legacy");
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
      content: "Session-local, non-authoritative mini-self-org workpad.\nCurrent until replaced or cleared. The only registered mini-self-org tools are mini-self-org-workpad and mini-self-org-history; workpad alone is not registered and must never be called as a tool.\n\nOverall goal: Ship\nCurrent focus: Test focus\nNext actions:\n- Test\nBlockers: [none]\nNotes:\n- Keep small",
    });
    expect(result.messages[1].content).toContain("mini-self-org-workpad");
    expect(result.messages[1].content).toMatch(/workpad alone is not registered and must never be called as a tool/i);
  });

  it("reconstructs focus history: forward walk, dedupe, change markers, cleared entries", () => {
    const A = { overallGoal: "Ship", currentFocus: "Plan", nextActions: ["a1"], blockers: [], notes: [] };
    const B = { overallGoal: "Ship", currentFocus: "Plan", nextActions: ["a2"], blockers: ["b"], notes: [] };
    const cleared = emptySnapshot();
    const A2 = { overallGoal: "Back to A", currentFocus: "Resume", nextActions: [], blockers: [], notes: ["n"] };
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
    expect(history.entries[3].changed).toEqual(["overallGoal", "currentFocus", "notes"]);
  });

  it("caps history at the requested limit and clamps out-of-range limits", () => {
    const entries = Array.from({ length: 20 }, (_, i) => workpadEntry(TOOL_NAME, { overallGoal: `Goal ${i}`, currentFocus: `Focus ${i}`, nextActions: [], blockers: [], notes: [] }));
    expect(reconstructHistory(context(entries)).entries).toHaveLength(10);
    expect(reconstructHistory(context(entries)).entries[0].snapshot.overallGoal).toBe("Goal 10");
    expect(reconstructHistory(context(entries), 3).entries[0].snapshot.overallGoal).toBe("Goal 17");
    expect(reconstructHistory(context(entries), 100).entries).toHaveLength(15);
    expect(reconstructHistory(context(entries), 15).entries[0].snapshot.overallGoal).toBe("Goal 5");
  });

  it("returns an empty history without ids when the branch has no workpad results", () => {
    const history = reconstructHistory(context([{ type: "message", message: { role: "toolResult", toolName: "read", details: undefined } }]));
    expect(history).toEqual({ total: 0, entries: [] });
    expect(JSON.stringify(history)).not.toMatch(/mso-wp|wp-\d/);
  });

  it("formats focus history newest last with cleared entries, clocks, and no id column", () => {
    const entries = [
      workpadEntry("workpad", { overallGoal: "First", currentFocus: "Inspect", nextActions: [], blockers: [], notes: [] }, 1_700_000_000_000),
      workpadEntry(TOOL_NAME, emptySnapshot()),
    ];
    const text = formatFocusHistory(reconstructHistory(context(entries)));
    expect(text.split("\n")[0]).toBe("Focus history (branch-local, newest last) — 2 of 2, non-authoritative:");
    expect(text.split("\n")[1]).toMatch(/^\[\d{2}:\d{2}\] start: Overall goal: First; Current focus: Inspect$/);
    expect(text.split("\n")[2]).toBe("[--:--] — cleared —");
    expect(formatFocusHistory(reconstructHistory(context([])))).toBe("No focus history yet — this branch has no mini-self-org-workpad updates.");
  });

  it("retains an overall goal when only the current focus is cleared, and clears every field for a full clear", async () => {
    const { tool, handlers } = setup();
    const focusCleared = await tool.execute("id", { overallGoal: "Ship", currentFocus: null, nextActions: [], blockers: [], notes: [] });
    const injected = await handlers.get("context")?.({ messages: [] }, context());

    expect(focusCleared.content[0].text).toBe("Mini self-org workpad updated.");
    expect(focusCleared.details.snapshot).toEqual({ overallGoal: "Ship", currentFocus: null, nextActions: [], blockers: [], notes: [] });
    expect(tool.renderResult(focusCleared, {}, {}, {}).render(80)).toContain("Overall goal: Ship");
    expect(injected).toMatchObject({ messages: [expect.objectContaining({ content: expect.stringContaining("Overall goal: Ship") })] });
    expect(emptySnapshot()).toEqual({ overallGoal: null, currentFocus: null, nextActions: [], blockers: [], notes: [] });
  });

  it("registers a read-only mini-self-org-history tool with re-orientation guidance", () => {
    const { tool, tools } = setup();
    const history = tools.get("mini-self-org-history");
    expect(history.label).toBe("Mini self-org focus history");
    expect(history.description).toContain("non-authoritative");
    expect(history.description).toContain("focus history");
    expect(history.description).toContain("after context compaction");
    expect(history.description).toContain("before clearing");
    expect(history.description).toContain("before starting a new work thread");
    expect(history.description).toContain("overall goal");
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
    expect(result.content[0].text).toContain("start: Overall goal: Ship; Current focus: Test focus");
    expect(result.content[0].text).toContain("— cleared —");
    expect(result.details).toEqual({});
    const limited = await history.execute("id", { limit: 1 }, undefined, undefined, context(entries));
    expect(limited.content[0].text).toContain("— 1 of 2, non-authoritative:");
    expect(limited.content[0].text).toContain("— cleared —");
    const update = await tool.execute("id", valid);
    expect(update.details.snapshot).toEqual({ overallGoal: "Ship", currentFocus: "Test focus", nextActions: ["Test"], blockers: [], notes: ["Keep small"] });
  });

  it("notifies the focused branch history from the /mini-self-org-history command", async () => {
    const { commands } = setup();
    const entries = [workpadEntry("workpad", { overallGoal: "Command goal", currentFocus: "Inspect", nextActions: [], blockers: [], notes: [] })];
    const notify = vi.fn();
    await commands.get("mini-self-org-history").handler("", { ui: { notify }, sessionManager: { getBranch: () => entries } });
    expect(notify.mock.calls[0][0]).toContain("Command goal");
    expect(notify.mock.calls[0][0]).toContain("non-authoritative");
    expect(notify.mock.calls[0][1]).toBe("info");
  });

});
