import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import miniSelfOrg, { emptySnapshot, formatFocusHistory, formatWorkpad, reconstructHistory, reconstructSnapshot, sanitizeSnapshot, WorkpadGetParameters, WorkpadParameters, WORKPAD_GET_TOOL_NAME } from "../src/mini-self-org.js";

const TOOL_NAME = "self-org-workpad-set";
const HISTORICAL_TOOL_NAME = "mini-self-org-workpad";
const HISTORY_TOOL_NAME = "self-org-workpad-history";
const WORKPAD_CUSTOM_TYPE = "mini-self-org-workpad";
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

function setupWithInjection(value: string | undefined) {
  const original = process.env.MINI_SELF_ORG_INJECTION;
  if (value === undefined) delete process.env.MINI_SELF_ORG_INJECTION;
  else process.env.MINI_SELF_ORG_INJECTION = value;
  try {
    return setup();
  } finally {
    if (original === undefined) delete process.env.MINI_SELF_ORG_INJECTION;
    else process.env.MINI_SELF_ORG_INJECTION = original;
  }
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

  it("registers exactly the renamed callable tools and stale-state guidance", () => {
    const { tool, tools, commands } = setup();
    expect([...tools.keys()]).toEqual([TOOL_NAME, WORKPAD_GET_TOOL_NAME, HISTORY_TOOL_NAME]);
    expect(tool.name).toBe(TOOL_NAME);
    expect(tool.label).toBe("Mini self-org workpad");
    expect(tool.description).toContain(TOOL_NAME);
    expect(tool.description).toMatch(/workpad alone is not registered and must never be called as a tool/i);
    expect(tool.description).toContain('{ overallGoal: "…", currentFocus: "…", nextActions: ["…"], blockers: [], notes: [] }');
    expect(tool.description).toContain("lists are arrays, not JSON-encoded strings");
    expect(tool.description).toContain("higher-level goals and durable steering");
    expect(tool.description).toContain("Do not copy details already available in the conversation or tool results");
    expect(tool.description).toContain("Keep self-org-workpad-set lists to 1–3 items typically (max 5).");
    expect(tool.description).toContain("[unverified], [verified], or [research]");
    expect(tool.description).toContain("replace the complete snapshot before the next consequential tool/action batch");
    expect(tool.description).toContain("Do not update ritualistically after every tool");
    expect(tool.promptGuidelines[0]).toContain("higher-level goals and durable steering");
    expect(tool.promptGuidelines).toEqual(expect.arrayContaining([expect.stringContaining("Do not merely state that it is stale"), expect.stringMatching(/workpad alone is not registered and must never be called as a tool/i), expect.stringContaining("your own recalled state, not user input")]));
    expect(tool.promptGuidelines.every((guideline: string) => guideline.includes(TOOL_NAME))).toBe(true);
    expect(commands.get("mini-self-org").description).toContain("read-only");
  });

  it("registers a read-only workpad-get tool", async () => {
    const { tools } = setup();
    const get = tools.get(WORKPAD_GET_TOOL_NAME);

    expect(get.name).toBe(WORKPAD_GET_TOOL_NAME);
    expect(get.label).toBe("Mini self-org workpad (read)");
    expect(get.promptGuidelines).toEqual([]);
    expect(TypeCompiler.Compile(WorkpadGetParameters).Check({})).toBe(true);
    expect((await get.execute("id", {})).content[0].text).toBe(formatWorkpad(emptySnapshot()));
  });

  it("workpad-get execute returns formatted snapshot and does not mutate state", async () => {
    const { handlers, tool, tools } = setupWithInjection("scheduled:2");
    const get = tools.get(WORKPAD_GET_TOOL_NAME);
    const written = await tool.execute("id", valid);
    const before = await get.execute("id", {});
    const after = await get.execute("id", {});

    expect(before.content[0].text).toBe(formatWorkpad(written.details.snapshot));
    expect(after.content[0].text).toBe(before.content[0].text);
    expect(before.details).toEqual({});
    expect(get.renderResult(before, {}, {}, {}).render(80)).toEqual(before.content[0].text.split("\n"));

    const contextHandler = handlers.get("context")!;
    expect((await contextHandler({ messages: [] }, context())).messages).toHaveLength(0);
    expect((await contextHandler({ messages: [] }, context())).messages).toHaveLength(1);
  });

  it("describes every workpad field as high-level durable steering rather than transient status", () => {
    expect(WorkpadParameters.properties.overallGoal.description).toContain("high-level outcome");
    expect(WorkpadParameters.properties.currentFocus.description).toContain("not the latest command");
    expect(WorkpadParameters.properties.nextActions.description).toContain("not a tool-by-tool checklist");
    expect(WorkpadParameters.properties.blockers.description).toContain("exclude transient command failures");
    expect(WorkpadParameters.properties.notes.description).toContain("exclude logs, tool output, versions");
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
      content: [{ type: "text", text: `Validation failed for tool "${TOOL_NAME}":\n  - nextActions.0: must be string\nReceived arguments: ...` }],
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

  it("reconstructs the last valid snapshot from legacy, historical, and current write tool results", async () => {
    const { handlers, commands } = setup();
    const legacy = { goal: "Legacy", nextActions: [], blockers: [], notes: [] };
    const historical = { overallGoal: "Historical work thread", currentFocus: "Historical", nextActions: [], blockers: [], notes: [] };
    const current = { overallGoal: "Current work thread", currentFocus: "Current", nextActions: ["Do it"], blockers: [], notes: [] };
    await handlers.get("session_start")?.({}, context([workpadEntry("workpad", legacy), workpadEntry(HISTORICAL_TOOL_NAME, historical), workpadEntry(TOOL_NAME, current), workpadEntry(HISTORY_TOOL_NAME, { overallGoal: "Ignored history read", currentFocus: "Ignored", nextActions: [], blockers: [], notes: [] })]));
    const notify = vi.fn();
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    expect(notify.mock.calls[0][0]).toContain("Overall goal: Current work thread");
    expect(notify.mock.calls[0][0]).toContain("Current focus: Current");

    await handlers.get("session_tree")?.({}, context([workpadEntry("workpad", legacy)]));
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    expect(notify.mock.calls[1][0]).toContain("Overall goal: [none]");
    expect(notify.mock.calls[1][0]).toContain("Current focus: Legacy");
  });

  it("defaults to never so the pure tools are the LLM access interface", async () => {
    for (const value of [undefined, ""]) {
      const { handlers } = setupWithInjection(value);
      const branch = context([workpadEntry(TOOL_NAME, valid)]);
      await handlers.get("session_start")?.({}, branch);
      await handlers.get("before_agent_start")?.({}, context());
      const contextHandler = handlers.get("context")!;
      expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);
      expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);
    }
  });

  it("uses 'always' to inject exactly one canonical current context block only when non-empty", async () => {
    const { handlers } = setupWithInjection("always");
    const contextHandler = handlers.get("context");
    const existing = { role: "custom", customType: WORKPAD_CUSTOM_TYPE, content: "old", display: false, timestamp: 1 };
    const user = { role: "user", content: "keep", timestamp: 1 };
    expect(await contextHandler?.({ messages: [user, existing] }, context())).toEqual({ messages: [user] });

    await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, valid)]));
    const result = (await contextHandler?.({ messages: [user, existing] }, context())) as { messages: any[] };
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      role: "custom",
      customType: WORKPAD_CUSTOM_TYPE,
      display: false,
      content: "Your own working scratchpad — high-level steering for this session, not a record and not a message from the user. Never acknowledge, restate, or quote it; use it to steer your next action. Re-derive operational facts from the conversation and tools rather than treating the snapshot as ground truth.\nCurrent until replaced or cleared.\n\nOverall goal: Ship\nCurrent focus: Test focus\nNext actions:\n- Test\nBlockers: [none]\nNotes:\n- Keep small",
    });
    expect(result.messages[1].content).toContain("not a message from the user");
    expect(result.messages[1].content).not.toMatch(/must never be called as a tool/);
  });

  it("emits byte-identical context content while the snapshot is unchanged", async () => {
    // Cache-relevant invariant: pi serializes only content, never the message timestamp, so an
    // unchanged snapshot must not introduce divergence at the tail between requests.
    const { handlers } = setupWithInjection("always");
    await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, valid)]));
    const contextHandler = handlers.get("context");
    const first = (await contextHandler?.({ messages: [] }, context())) as { messages: any[] };
    const second = (await contextHandler?.({ messages: [] }, context())) as { messages: any[] };
    expect(first.messages[0].content).toBe(second.messages[0].content);
  });

  it("reconstructs focus history: forward walk, dedupe, change markers, cleared entries", () => {
    const A = { overallGoal: "Ship", currentFocus: "Plan", nextActions: ["a1"], blockers: [], notes: [] };
    const B = { overallGoal: "Ship", currentFocus: "Plan", nextActions: ["a2"], blockers: ["b"], notes: [] };
    const cleared = emptySnapshot();
    const A2 = { overallGoal: "Back to A", currentFocus: "Resume", nextActions: [], blockers: [], notes: ["n"] };
    const entries = [
      workpadEntry("workpad", A),
      workpadEntry(HISTORICAL_TOOL_NAME, A),
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
    expect(formatFocusHistory(reconstructHistory(context([])))).toBe("No focus history yet — this branch has no self-org-workpad-set updates.");
  });

  it("retains an overall goal when only the current focus is cleared, and clears every field for a full clear", async () => {
    const { tool, handlers } = setupWithInjection("always");
    const focusCleared = await tool.execute("id", { overallGoal: "Ship", currentFocus: null, nextActions: [], blockers: [], notes: [] });
    const injected = await handlers.get("context")?.({ messages: [] }, context());

    expect(focusCleared.content[0].text).toBe("Mini self-org workpad updated.");
    expect(focusCleared.details.snapshot).toEqual({ overallGoal: "Ship", currentFocus: null, nextActions: [], blockers: [], notes: [] });
    expect(tool.renderResult(focusCleared, {}, {}, {}).render(80)).toContain("Overall goal: Ship");
    expect(injected).toMatchObject({ messages: [expect.objectContaining({ content: expect.stringContaining("Overall goal: Ship") })] });
    expect(emptySnapshot()).toEqual({ overallGoal: null, currentFocus: null, nextActions: [], blockers: [], notes: [] });
  });

  it("registers a read-only self-org-workpad-history tool with re-orientation guidance", () => {
    const { tool, tools } = setup();
    const history = tools.get(HISTORY_TOOL_NAME);
    expect(history.label).toBe("Mini self-org focus history");
    expect(history.description).toContain("non-authoritative");
    expect(history.description).toContain("focus history");
    expect(history.description).toContain("after context compaction");
    expect(history.description).toContain("before clearing");
    expect(history.description).toContain("before starting a new work thread");
    expect(history.description).toContain("overall goal");
    expect(history.promptGuidelines).toEqual(expect.arrayContaining([expect.stringContaining("after context compaction")]));
    expect(history.parameters.properties.limit.description).toContain("1-15");
    expect(tool.description).toContain("read via self-org-workpad-history");
  });

  it("validates history parameters through the TypeBox compiler", () => {
    const { tools } = setup();
    const compiler = TypeCompiler.Compile(tools.get(HISTORY_TOOL_NAME).parameters);
    expect(compiler.Check({})).toBe(true);
    expect(compiler.Check({ limit: 3 })).toBe(true);
    expect(compiler.Check({ limit: 0 })).toBe(false);
    expect(compiler.Check({ limit: 16 })).toBe(false);
    expect(compiler.Check({ limit: 1.5 })).toBe(false);
  });

  it("serves focus history from the tool context and never mutates the current snapshot", async () => {
    const { tool, tools } = setup();
    const history = tools.get(HISTORY_TOOL_NAME);
    const entries = [workpadEntry(TOOL_NAME, valid), workpadEntry(HISTORY_TOOL_NAME, { overallGoal: "Ignored history read", currentFocus: "Ignored", nextActions: [], blockers: [], notes: [] }), workpadEntry(TOOL_NAME, emptySnapshot())];
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

  it("accepts only the supported injection policy configuration", () => {
    for (const value of [undefined, "", "always", "user-boundary", "never", "scheduled:2"]) {
      expect(() => setupWithInjection(value)).not.toThrow();
    }
    for (const value of ["Always", " user-boundary", "scheduled:0", "scheduled:-1", "scheduled:1.5", "scheduled:01", "scheduled:9007199254740992", "other"]) {
      expect(() => setupWithInjection(value)).toThrow(/MINI_SELF_ORG_INJECTION/);
    }
  });

  it("injects user-boundary state once, consumes empty boundaries, and removes stale blocks while suppressed", async () => {
    const { handlers } = setupWithInjection("user-boundary");
    const contextHandler = handlers.get("context")!;
    const user = { role: "user", content: "keep", timestamp: 1 };
    const stale = { role: "custom", customType: WORKPAD_CUSTOM_TYPE, content: "old", display: false, timestamp: 1 };
    await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, valid)]));
    expect((await contextHandler({ messages: [user] }, context())).messages).toHaveLength(2);
    expect(await contextHandler({ messages: [user, stale] }, context())).toEqual({ messages: [user] });
    await handlers.get("before_agent_start")?.({}, context());
    expect((await contextHandler({ messages: [user] }, context())).messages).toHaveLength(2);

    const empty = setupWithInjection("user-boundary");
    await empty.handlers.get("before_agent_start")?.({}, context());
    await empty.handlers.get("context")!({ messages: [] }, context());
    await empty.tool.execute("id", valid);
    expect((await empty.handlers.get("context")!({ messages: [] }, context())).messages).toEqual([]);

    const recoveredEmpty = setupWithInjection("user-boundary");
    await recoveredEmpty.handlers.get("session_start")?.({}, context());
    await recoveredEmpty.handlers.get("context")!({ messages: [] }, context());
    await recoveredEmpty.tool.execute("id", valid);
    expect((await recoveredEmpty.handlers.get("context")!({ messages: [] }, context())).messages).toHaveLength(1);
  });

  it("never mode: suppresses all injection but still strips stale blocks", async () => {
    const { handlers, tool, tools } = setupWithInjection("never");
    const contextHandler = handlers.get("context")!;
    const get = tools.get(WORKPAD_GET_TOOL_NAME);
    const branch = context([workpadEntry(TOOL_NAME, valid)]);
    await handlers.get("session_start")?.({}, branch);

    // Even with a populated workpad and session_start (recovery trigger), no injection:
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);

    // Tree navigation (recovery trigger) does not trigger injection either:
    await handlers.get("session_tree")?.({}, branch);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);

    // User boundary does not trigger injection either:
    await handlers.get("before_agent_start")?.({}, context());
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);

    // Stale blocks are still stripped:
    const stale = { role: "custom", customType: WORKPAD_CUSTOM_TYPE, content: "old", display: false, timestamp: 1 };
    const result = await contextHandler({ messages: [stale] }, branch);
    expect(result.messages).toHaveLength(0);
    expect(result.messages.find((message: any) => message.customType === TOOL_NAME)).toBeUndefined();

    // Write tool still works and does not trigger injection:
    await tool.execute("id", valid);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);

    // A rejected write does not trigger injection either:
    expect((await tool.execute("id", { ...valid, blockers: ["a", "b", "c"] })).isError).toBe(true);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);

    // Compaction does not trigger injection:
    await handlers.get("session_compact")?.({}, branch);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);

    // workpad-get still returns the current snapshot in never mode (no injection needed):
    const read = await get.execute("id", {});
    expect(read.isError).toBeUndefined();
    expect(read.content[0].text).toContain("Overall goal: Ship");
  });

  it("schedules injections from writes and recovers after tree navigation and compaction", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:2");
    const contextHandler = handlers.get("context")!;
    const branch = context([workpadEntry(TOOL_NAME, valid)]);
    await handlers.get("session_start")?.({}, branch);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(1);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);
    await tool.execute("id", valid);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(1);
    await handlers.get("session_tree")?.({}, branch);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(1);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);
    await handlers.get("session_compact")?.({}, branch);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(1);
  });

  it("does not reset scheduled cadence after a rejected workpad write", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:3");
    const branch = context([workpadEntry(TOOL_NAME, valid)]);
    const contextHandler = handlers.get("context")!;
    await handlers.get("session_start")?.({}, branch);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(1);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);
    expect((await tool.execute("id", { ...valid, blockers: ["a", "b", "c"] })).isError).toBe(true);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);
    expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(1);
  });

  it("makes scheduled:1 equivalent to always for non-empty state", async () => {
    const { handlers } = setupWithInjection("scheduled:1");
    await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, valid)]));
    const contextHandler = handlers.get("context")!;
    expect((await contextHandler({ messages: [] }, context())).messages).toHaveLength(1);
    expect((await contextHandler({ messages: [] }, context())).messages).toHaveLength(1);
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
