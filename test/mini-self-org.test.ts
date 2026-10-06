import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import miniSelfOrg, { emptySnapshot, formatFocusHistory, formatWorkpad, reconstructHistory, reconstructLastPersisted, reconstructSnapshot, reconstructUserDirective, sanitizeSnapshot, USER_PIN_CUSTOM_TYPE, WorkpadGetParameters, WorkpadParameters, WORKPAD_GET_TOOL_NAME } from "../src/mini-self-org.js";

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
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;
  miniSelfOrg(pi);
  return { handlers, tool: tools.get(TOOL_NAME), tools, commands, pi };
}

function setupWithInjection(value: string | undefined, options?: { captureWarn?: boolean }) {
  const original = process.env.MINI_SELF_ORG_INJECTION;
  if (value === undefined) delete process.env.MINI_SELF_ORG_INJECTION;
  else process.env.MINI_SELF_ORG_INJECTION = value;
  const warnSpy = options?.captureWarn ? vi.spyOn(console, "warn").mockImplementation(() => {}) : undefined;
  try {
    return { ...setup(), warnSpy };
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
const pinEntry = (text: string | null, timestamp = 1) => ({ type: "custom", customType: USER_PIN_CUSTOM_TYPE, data: { text, timestamp } });

const commandCtx = (ui: Record<string, any> = {}) => ({ hasUI: false, ui: { notify: vi.fn(), ...ui }, sessionManager: { getBranch: () => [] } });

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
    expect(tool.promptGuidelines).toEqual(expect.arrayContaining([expect.stringContaining("Do not merely state that it is stale"), expect.stringMatching(/workpad alone is not registered and must never be called as a tool/i), expect.stringContaining("The self-org-workpad-set workpad sheets are persisted into the conversation history at turn boundaries and are your own recalled state, not user input: never acknowledge, restate, or quote them")]));
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
    // Strip-only context hook: even a populated workpad never injects (scheduled:N injects at
    // turn_end, not per request). Stale WORKPAD_CUSTOM_TYPE custom messages are still stripped.
    const stale = { role: "custom", customType: WORKPAD_CUSTOM_TYPE, content: "old", display: false, timestamp: 1 };
    expect((await contextHandler({ messages: [stale] }, context())).messages).toEqual([]);
    expect((await contextHandler({ messages: [] }, context())).messages).toEqual([]);
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
      await handlers.get("before_agent_start")?.({}, branch);
      const contextHandler = handlers.get("context")!;
      // never mode: context hook is strip-only and turn_end never appends — no injection.
      expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);
      expect((await contextHandler({ messages: [] }, branch)).messages).toHaveLength(0);
      expect(await handlers.get("turn_end")?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, branch)).toBeUndefined();
    }
  });

  it("'always' is rejected with a migration warning and falls back to never (no throw)", async () => {
    const { handlers, warnSpy: _warnSpy } = setupWithInjection("always", { captureWarn: true });
    const warnSpy = _warnSpy!;
    // No throw: the extension initializes with a never fallback, preserving tool access.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/scheduled:1/);
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/scheduled:N/);

    // never fallback: context hook strips (no injection) and turn_end never appends.
    await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, valid)]));
    await handlers.get("before_agent_start")?.({}, context());
    const contextHandler = handlers.get("context")!;
    expect((await contextHandler({ messages: [] }, context())).messages).toEqual([]);
    expect(await handlers.get("turn_end")?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("context hook is strip-only in every mode: never injects, always strips stale workpad custom messages", async () => {
    const stale = { role: "custom", customType: WORKPAD_CUSTOM_TYPE, content: "old", display: false, timestamp: 1 };
    const user = { role: "user", content: "keep", timestamp: 1 };
    // The strip is unconditional across all modes — even a populated workpad never injects via context.
    for (const value of ["never", "off", "user-boundary", "scheduled:2", "scheduled:1"]) {
      const { handlers, tool } = setupWithInjection(value);
      await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, valid)]));
      await handlers.get("before_agent_start")?.({}, context());
      await tool.execute("id", valid);
      await handlers.get("session_compact")?.({}, context());
      const contextHandler = handlers.get("context")!;
      // Stale workpad custom messages are stripped, non-workpad messages are kept, nothing is injected.
      expect(await contextHandler({ messages: [user, stale] }, context())).toEqual({ messages: [user] });
      expect((await contextHandler({ messages: [] }, context())).messages).toEqual([]);
    }
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

  it("T6: history-tool isolation — reconstructHistory identical with vs. without WORKPAD_CUSTOM_TYPE sheets (F11)", () => {
    const A = { overallGoal: "Ship", currentFocus: "Plan", nextActions: ["a1"], blockers: [], notes: [] };
    const B = { overallGoal: "Ship", currentFocus: "Execute", nextActions: ["b1"], blockers: [], notes: [] };
    const A2 = { overallGoal: "Ship", currentFocus: "Resume", nextActions: [], blockers: [], notes: ["n"] };
    const sheetGhost = { overallGoal: "Sheet ghost", currentFocus: "Ghost focus", nextActions: ["ghost"], blockers: [], notes: [] };
    const sheet = (turnIndex: number) => ({
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: `Mini self-org workpad — history checkpoint (turn ${turnIndex})`,
      display: false,
      details: { snapshot: sheetGhost },
    });

    const branchWithoutSheets = [workpadEntry(TOOL_NAME, A), workpadEntry(TOOL_NAME, B), workpadEntry(TOOL_NAME, A2)];
    const branchWithSheets = [sheet(1), ...branchWithoutSheets, sheet(2), sheet(3)];

    const withoutSheets = reconstructHistory(context(branchWithoutSheets));
    const withSheets = reconstructHistory(context(branchWithSheets));

    expect(withSheets).toEqual(withoutSheets);
    expect(withoutSheets.total).toBe(3);
    expect(withoutSheets.entries).toHaveLength(3);
    expect(JSON.stringify(withoutSheets)).not.toMatch(/Sheet ghost/);
    expect(JSON.stringify(withSheets)).not.toMatch(/Sheet ghost/);
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
    const { tool } = setupWithInjection("scheduled:2");
    const focusCleared = await tool.execute("id", { overallGoal: "Ship", currentFocus: null, nextActions: [], blockers: [], notes: [] });

    expect(focusCleared.content[0].text).toBe("Mini self-org workpad updated.");
    expect(focusCleared.details.snapshot).toEqual({ overallGoal: "Ship", currentFocus: null, nextActions: [], blockers: [], notes: [] });
    expect(tool.renderResult(focusCleared, {}, {}, {}).render(80)).toContain("Overall goal: Ship");
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
    // Accepted: never/off aliases, the two persistent modes, the history-scheduled alias,
    // and the composite form (order-independent).
    for (const value of [undefined, "", "never", "off", "scheduled:2", "scheduled:4", "user-boundary", "history-scheduled:8", "user-boundary+scheduled:3", "scheduled:3+user-boundary", "user-boundary+history-scheduled:3", "history-scheduled:3+user-boundary"]) {
      expect(() => setupWithInjection(value)).not.toThrow();
    }
    // Rejected (hard throw): malformed values that are not a silent alias or valid composite.
    for (const value of ["Always", " user-boundary", "scheduled:0", "scheduled:-1", "scheduled:1.5", "scheduled:01", "scheduled:9007199254740992", "history-scheduled:0", "history-scheduled:", "history-scheduled:-1", "history-scheduled:x", "HISTORY-scheduled:8", "history-scheduled:8.0", "history-scheduled:9007199254740992", "other", "never+user-boundary", "off+scheduled:2", "always+user-boundary", "user-boundary+user-boundary", "scheduled:2+scheduled:3", "scheduled:2+history-scheduled:3", "user-boundary+", "+scheduled:2", "+", "user-boundary +scheduled:2", "user-boundary+scheduled: ", "foo+user-boundary", "user-boundary+scheduled:", "user-boundary+scheduled:0", "user-boundary+scheduled:1.5", "user-boundary+scheduled:01"]) {
      expect(() => setupWithInjection(value)).toThrow(/MINI_SELF_ORG_INJECTION/);
    }
    // 'always' is a warn + never fallback, NOT a hard throw (spec §1/§11-5).
    const { warnSpy: _warnSpy } = setupWithInjection("always", { captureWarn: true });
    const warnSpy = _warnSpy!;
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/scheduled:1|never/);
    warnSpy.mockRestore();
    expect(setupWithInjection("always", {}).handlers.get("turn_end")).toBeDefined();
  });

  it("T1a: history-scheduled:N is aliased to { mode: scheduled, interval: N } (lossless rename, no warning)", async () => {
    // Alias produces no warning (spec §11-4: silent lossless rename).
    const { warnSpy: _warnSpy } = setupWithInjection("history-scheduled:4", { captureWarn: true });
    const warnSpy = _warnSpy!;
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();

    // Behavior is identical to scheduled:N: verify a history-scheduled:2 setup appends on the
    // 2nd completed turn, exactly like scheduled:2 (the internal mode is "scheduled").
    const aliased = setupWithInjection("history-scheduled:2");
    await aliased.tool.execute("id", valid);
    const turnEnd = aliased.handlers.get("turn_end")!;
    expect(await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();
    expect((await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).entries).toHaveLength(1);

    // A direct scheduled:2 setup exhibits the identical cadence — confirming the alias maps to scheduled.
    const direct = setupWithInjection("scheduled:2");
    await direct.tool.execute("id", valid);
    const directTurnEnd = direct.handlers.get("turn_end")!;
    expect(await directTurnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();
    expect((await directTurnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).entries).toHaveLength(1);
  });

  it("user-boundary persistent mode: before_agent_start arms; first completed turn_end appends; second does not; next before_agent_start re-arms", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary");
    const turnEnd = handlers.get("turn_end");
    const beforeAgentStart = handlers.get("before_agent_start");
    await tool.execute("id", valid);

    // User loop 1: arm the boundary, then the first completed turn appends.
    await beforeAgentStart?.({}, context());
    expect((await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).entries).toHaveLength(1);
    // Second completed turn in the same user loop does NOT re-append (boundary consumed).
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();

    // User loop 2: re-arming re-enables the append.
    await beforeAgentStart?.({}, context());
    expect((await turnEnd?.({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context())).entries).toHaveLength(1);
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 4, outcome: "completed" }, context())).toBeFalsy();
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

  it("schedules appends at the Nth completed turn, and recovers (force append) after tree navigation and compaction", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:2");
    const turnEnd = handlers.get("turn_end")!;
    const branch = context([workpadEntry(TOOL_NAME, valid)]);
    await handlers.get("session_start")?.({}, branch);
    await tool.execute("id", valid);

    // D3 resume: session_start arms forceNextAppend, so the first completed turn force-appends
    // regardless of the window (force is consumed).
    expect((await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, branch)).entries).toHaveLength(1);

    // Normal cadence resumes: counter starts at 1 (turn 2) < 2 → no; counter 2 (turn 3) → append, reset to 0.
    expect(await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, branch)).toBeFalsy();
    expect((await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, branch)).entries).toHaveLength(1);

    // Tree navigation is a boundary crossing (reconstruct sets forceNextAppend): next completed turn appends.
    await handlers.get("session_tree")?.({}, branch);
    expect((await turnEnd({ type: "turn_end", turnIndex: 4, outcome: "completed" }, branch)).entries).toHaveLength(1);

    // Compaction forces one immediate append, bypassing the counter wait.
    await handlers.get("session_compact")?.({}, branch);
    expect((await turnEnd({ type: "turn_end", turnIndex: 5, outcome: "completed" }, branch)).entries).toHaveLength(1);
  });

  it("does not reset scheduled cadence after a rejected workpad write (Q4: write does not reset the turn window)", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:3");
    const turnEnd = handlers.get("turn_end")!;
    // No session_start here: it would arm a D3 resume force (forceNextAppend) that appends on the
    // first completed turn regardless of the window. A fresh setup has no force, so the window is
    // pure cadence. (A fresh setup's snapshot is empty; the write below populates it.)
    await tool.execute("id", valid);

    // Cadence: 1st and 2nd completed turns no, 3rd yes (reaches interval 3). A rejected write
    // between turns does not reset the window — cadence is governed by the turn counter, not writes.
    expect(await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();
    expect(await tool.execute("id", { ...valid, blockers: ["a", "b", "c"] })).toMatchObject({ isError: true });
    expect(await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
    expect((await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context())).entries).toHaveLength(1);
  });

  it("makes scheduled:1 append a sheet on every completed turn for non-empty state", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:1");
    const turnEnd = handlers.get("turn_end")!;
    await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, valid)]));
    await tool.execute("id", valid);
    expect((await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).entries).toHaveLength(1);
    expect((await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).entries).toHaveLength(1);
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

  it("T9: reload reconstruction — reads lastPersisted from custom_message and resets turnsSinceLastAppend", async () => {
    const { handlers } = setupWithInjection("scheduled:3");
    const customMsg = {
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: "sheet body",
      details: { snapshot: valid },
      display: false,
      id: "cm1",
      parentId: "msg1",
      timestamp: 1,
    };
    // Branch with both a toolResult (copy ②) and a custom_message sheet
    const branch = context([workpadEntry(TOOL_NAME, valid), customMsg]);
    await handlers.get("session_start")?.({}, branch);

    // reconstructLastPersisted returns the sanitized snapshot from the custom_message
    expect(reconstructLastPersisted(branch)).toEqual({
      overallGoal: "Ship",
      currentFocus: "Test focus",
      nextActions: ["Test"],
      blockers: [],
      notes: ["Keep small"],
    });

    // Branch with only toolResult entries (no custom_message) → null
    const toolOnly = context([workpadEntry(TOOL_NAME, valid)]);
    expect(reconstructLastPersisted(toolOnly)).toBeNull();

    // Branch with multiple custom_message entries → returns the NEWEST one
    const older = {
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: "older",
      details: { snapshot: { overallGoal: "Old goal", currentFocus: "Old focus", nextActions: [], blockers: [], notes: [] } },
      display: false,
      id: "cm-old",
      parentId: "msg0",
      timestamp: 0,
    };
    const newer = {
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: "newer",
      details: { snapshot: { overallGoal: "New goal", currentFocus: "New focus", nextActions: ["do it"], blockers: [], notes: [] } },
      display: false,
      id: "cm-new",
      parentId: "msg1",
      timestamp: 2,
    };
    const multiBranch = context([older, newer]);
    expect(reconstructLastPersisted(multiBranch)).toEqual({
      overallGoal: "New goal",
      currentFocus: "New focus",
      nextActions: ["do it"],
      blockers: [],
      notes: [],
    });
  });

  it("T10: post-compaction reconstruction edge — newest sheet or null", () => {
    const snapshotA = { overallGoal: "Ship", currentFocus: "Plan", nextActions: ["a1"], blockers: [], notes: [] };
    const snapshotB = { overallGoal: "Ship", currentFocus: "Execute", nextActions: ["b1"], blockers: [], notes: [] };

    const entryA: any = {
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: "sheet A",
      details: { snapshot: snapshotA },
      display: false,
      id: "cmA",
      parentId: "msgA",
      timestamp: 1,
    };
    const entryB: any = {
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: "sheet B",
      details: { snapshot: snapshotB },
      display: false,
      id: "cmB",
      parentId: "msgB",
      timestamp: 2,
    };

    // Both present: returns the newest (B)
    expect(reconstructLastPersisted(context([entryA, entryB]))).toEqual({
      overallGoal: "Ship",
      currentFocus: "Execute",
      nextActions: ["b1"],
      blockers: [],
      notes: [],
    });

    // B was summarized away: only A remains
    expect(reconstructLastPersisted(context([entryA]))).toEqual({
      overallGoal: "Ship",
      currentFocus: "Plan",
      nextActions: ["a1"],
      blockers: [],
      notes: [],
    });

    // No custom_message entries at all → null
    expect(reconstructLastPersisted(context([]))).toBeNull();
    expect(reconstructLastPersisted(context([workpadEntry(TOOL_NAME, snapshotA)]))).toBeNull();
  });

  it("T2: scheduled appends exactly on the Nth completed turn with a Q3 sheet body and no continue", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:3");
    const turnEnd = handlers.get("turn_end");
    expect(turnEnd).toBeDefined();
    await tool.execute("id", valid);

    const r1 = await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    const r2 = await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context());
    for (const r of [r1, r2]) {
      expect(r === undefined || r?.entries === undefined || r?.entries?.length === 0).toBe(true);
    }

    const r3 = await turnEnd?.({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(r3.entries).toHaveLength(1);
    const entry = r3.entries[0];
    expect(entry.type).toBe("custom_message");
    expect(entry.customType).toBe(WORKPAD_CUSTOM_TYPE);
    expect(entry.display).toBe(false);
    expect(entry.details.snapshot).toEqual({ overallGoal: "Ship", currentFocus: "Test focus", nextActions: ["Test"], blockers: [], notes: ["Keep small"] });
    expect(r3).not.toHaveProperty("continue");
    expect(entry.content).toContain("This is your own workpad state (set via self-org-workpad-set); never acknowledge, restate, or quote this block back to the user.");
    expect(entry.content.toLowerCase()).toContain("later tool activity may supersede this; authoritative state is maintained via the workpad tool");
    expect(entry.content).toContain("3");
    expect(entry.content).toContain("Overall goal: Ship");
  });

  it("T3: after a scheduled append, the window resets and requires N more completed turns", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:2");
    const turnEnd = handlers.get("turn_end");
    await tool.execute("id", valid);

    expect(await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();
    expect((await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).entries).toHaveLength(1);
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context())).toBeFalsy();
    expect((await turnEnd?.({ type: "turn_end", turnIndex: 4, outcome: "completed" }, context())).entries).toHaveLength(1);
  });

  it("T4: a workpad write does not reset the scheduled window (Q4)", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:3");
    const turnEnd = handlers.get("turn_end");
    await tool.execute("id", valid);

    expect(await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();
    const updated = await tool.execute("id", { ...valid, currentFocus: "Mid-window focus" });
    expect(updated.isError).toBeUndefined();
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
    const appended = await turnEnd?.({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(appended.entries).toHaveLength(1);
    expect(appended.entries[0].details.snapshot.currentFocus).toBe("Mid-window focus");
  });

  it("T7: a constant non-empty snapshot is re-appended every N turns (3 appends over 3*N turns, R1)", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:2");
    const turnEnd = handlers.get("turn_end");
    await tool.execute("id", valid);

    let appends = 0;
    for (let turn = 1; turn <= 6; turn++) {
      const result = await turnEnd?.({ type: "turn_end", turnIndex: turn, outcome: "completed" }, context());
      if (result?.entries?.length > 0) appends++;
    }
    expect(appends).toBe(3);
  });

  it("Q2: aborted or errored turns do not append and do not advance the scheduled counter", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:2");
    const turnEnd = handlers.get("turn_end");
    await tool.execute("id", valid);

    expect(await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "aborted" }, context())).toBeFalsy();
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "error" }, context())).toBeFalsy();
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
    expect((await turnEnd?.({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context())).entries).toHaveLength(1);
  });

  it("T8: compaction forces exactly one immediate append, then normal cadence resumes (Q1)", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:3");
    const turnEnd = handlers.get("turn_end");
    expect(turnEnd).toBeDefined();
    await tool.execute("id", valid);

    // Forced append: the very next completed turn_end appends even though counter 1 < 3.
    await handlers.get("session_compact")?.({}, context());
    const r1 = await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    const entry = r1.entries[0];
    expect(entry.type).toBe("custom_message");
    expect(entry.customType).toBe(WORKPAD_CUSTOM_TYPE);
    expect(entry.display).toBe(false);
    expect(entry.details.snapshot).toEqual({ overallGoal: "Ship", currentFocus: "Test focus", nextActions: ["Test"], blockers: [], notes: ["Keep small"] });
    expect(r1).not.toHaveProperty("continue");

    // Flag cleared: counter is at 2 (< 3) after the forced append reset it, so turn 2 does not append.
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();

    // Normal cadence resumed: after the forced append (which reset the counter), a full window of N more turns elapses before the next append.
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context())).toBeFalsy();
    expect((await turnEnd?.({ type: "turn_end", turnIndex: 4, outcome: "completed" }, context())).entries).toHaveLength(1);

    // Boundedness: two compactions in a row still yield exactly ONE forced append (boolean flag, not a counter), and the forced append reset the counter so no cadence append piggybacks on it.
    const bounded = setupWithInjection("scheduled:3");
    await bounded.tool.execute("id", valid);
    await bounded.handlers.get("session_compact")?.({}, context());
    await bounded.handlers.get("session_compact")?.({}, context());
    const forced = await bounded.handlers.get("turn_end")?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(forced.entries).toHaveLength(1);
    expect(await bounded.handlers.get("turn_end")?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
  });

  it("empty workpad: window ticks on every completed turn and appends a nudge sheet at the Nth turn (scheduled mode)", async () => {
    const { handlers } = setupWithInjection("scheduled:3");
    const turnEnd = handlers.get("turn_end");

    expect(await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
    const nudge = await turnEnd?.({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(nudge.entries).toHaveLength(1);
    expect(nudge.entries[0].customType).toBe(WORKPAD_CUSTOM_TYPE);
    expect(nudge.entries[0].content).toContain("the workpad is empty");
    expect(nudge.entries[0].content).toContain("self-org-workpad-set");
    expect(nudge.entries[0].details).toEqual({});

    // Window reset: no append on the next two turns, second nudge at the next boundary.
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 4, outcome: "completed" }, context())).toBeFalsy();
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 5, outcome: "completed" }, context())).toBeFalsy();
    expect((await turnEnd?.({ type: "turn_end", turnIndex: 6, outcome: "completed" }, context())).entries).toHaveLength(1);
  });

  it("empty workpad: counter advanced by empty turns is honored after the pad is populated (no double tick, full window required)", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:3");
    const turnEnd = handlers.get("turn_end");

    await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context());
    const nudge = await turnEnd?.({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(nudge.entries[0].content).toContain("the workpad is empty");

    await tool.execute("id", valid);
    // A full window of 3 completed turns is required before the first real sheet.
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 4, outcome: "completed" }, context())).toBeFalsy();
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 5, outcome: "completed" }, context())).toBeFalsy();
    const real = await turnEnd?.({ type: "turn_end", turnIndex: 6, outcome: "completed" }, context());
    expect(real.entries[0].details.snapshot.overallGoal).toBe("Ship");
    expect(real.entries[0].content).not.toContain("the workpad is empty");
  });

  it("scheduled force + empty workpad: compaction force is consumed by an immediate nudge sheet", async () => {
    const { handlers } = setupWithInjection("scheduled:3");
    const turnEnd = handlers.get("turn_end");

    // No pad set. Compaction arms forceNextAppend; the next completed turn must append a nudge.
    await handlers.get("session_compact")?.({}, context());
    const forced = await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(forced.entries).toHaveLength(1);
    expect(forced.entries[0].content).toContain("the workpad is empty");
    expect(forced.entries[0].details).toEqual({});

    // Force consumed and window reset: no append on the next two turns.
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context())).toBeFalsy();
  });

  it("user-boundary mode never appends for an empty workpad (nudge is scheduled-only)", async () => {
    const { handlers } = setupWithInjection("user-boundary");
    const turnEnd = handlers.get("turn_end");

    // before_agent_start arms the boundary; with an empty pad the completed turn must NOT append.
    await handlers.get("before_agent_start")?.({}, context());
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();
  });

  it("8b: session-cumulative turnIndex in sheet body", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:1");
    const turnEnd = handlers.get("turn_end");
    expect(turnEnd).toBeDefined();
    await tool.execute("id", valid);

    const r1 = await turnEnd?.({ type: "turn_end", turnIndex: 0, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    expect(r1.entries[0].content).toContain("Turn index: 1");
    expect(r1.entries[0].content).toContain("turn 1)");

    const r2 = await turnEnd?.({ type: "turn_end", turnIndex: 0, outcome: "completed" }, context());
    expect(r2.entries).toHaveLength(1);
    expect(r2.entries[0].content).toContain("Turn index: 2");
    expect(r2.entries[0].content).toContain("turn 2)");

    const r3 = await turnEnd?.({ type: "turn_end", turnIndex: 0, outcome: "completed" }, context());
    expect(r3.entries).toHaveLength(1);
    expect(r3.entries[0].content).toContain("Turn index: 3");
    expect(r3.entries[0].content).toContain("turn 3)");
  });

  it("T5: context hook is strip-only in all modes (no injection path, ever)", async () => {
    // The context hook is strip-only regardless of mode: it strips WORKPAD_CUSTOM_TYPE custom
    // messages and never injects. Verify under several modes, including a populated workpad.
    for (const value of ["scheduled:3", "user-boundary", "never", "off"]) {
      const { handlers, tool } = setupWithInjection(value);
      const contextHandler = handlers.get("context")!;
      const user = { role: "user", content: "keep", timestamp: 1 };
      const stale = { role: "custom", customType: WORKPAD_CUSTOM_TYPE, content: "old", display: false, timestamp: 1 };
      const branch = context([workpadEntry(TOOL_NAME, valid)]);

      // Reload edge: a stale workpad custom message is stripped and nothing is re-injected.
      await handlers.get("session_start")?.({}, branch);
      expect(await contextHandler({ messages: [user, stale] }, branch)).toEqual({ messages: [user] });

      // No transient sheet is ever appended, even with a non-empty snapshot, across repeated calls.
      expect((await contextHandler({ messages: [] }, branch)).messages).toEqual([]);
      expect((await contextHandler({ messages: [] }, branch)).messages).toEqual([]);

      // ...and still nothing after a workpad write or a compaction force flag.
      await tool.execute("id", valid);
      expect((await contextHandler({ messages: [] }, branch)).messages).toEqual([]);
      await handlers.get("session_compact")?.({}, branch);
      expect((await contextHandler({ messages: [] }, branch)).messages).toEqual([]);
    }
  });
  it("Q4: off mode never appends a sheet — no-injection switch across turns, writes, and compaction", async () => {
    const { handlers, tool } = setupWithInjection("off");
    const turnEnd = handlers.get("turn_end");
    expect(turnEnd).toBeDefined();
    await handlers.get("session_start")?.({}, context([workpadEntry(TOOL_NAME, valid)]));
    await tool.execute("id", valid);

    // Several turns, with workpad-set calls so the counter would advance if injection were active.
    const results: any[] = [];
    for (let turn = 1; turn <= 10; turn++) {
      if (turn % 3 === 0) await tool.execute("id", { ...valid, currentFocus: `Focus ${turn}` });
      results.push(await turnEnd?.({ type: "turn_end", turnIndex: turn, outcome: "completed" }, context()));
    }
    expect(results.every((result) => result === undefined)).toBe(true);

    // The compaction force-append flag is also inert in off mode.
    await handlers.get("session_compact")?.({}, context());
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 11, outcome: "completed" }, context())).toBeUndefined();

    // No custom_message sheet exists anywhere in the session, and none is ever produced.
    const session = results.filter((result) => result !== undefined).flatMap((result: any) => result.entries ?? []);
    expect(session.filter((entry: any) => entry?.type === "custom_message" && entry.customType === TOOL_NAME)).toHaveLength(0);
  });

  it("force in user-boundary mode: compaction forces the next completed turn_end to append without a prior before_agent_start; the one after doesn't", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary");
    const turnEnd = handlers.get("turn_end");
    await tool.execute("id", valid);

    // Compaction arms forceNextAppend (unified flag, both persistent modes) — no before_agent_start needed.
    await handlers.get("session_compact")?.({}, context());
    const r1 = await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    // The force is consumed: the following completed turn does NOT append (no boundary re-armed).
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
  });

  it("aborted turn does not consume the user-boundary boundary: before_agent_start → aborted turn_end → completed turn_end still appends", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary");
    const turnEnd = handlers.get("turn_end");
    await tool.execute("id", valid);

    await handlers.get("before_agent_start")?.({}, context());
    // An aborted turn exits before the boundary gate is evaluated — the boundary survives.
    expect(await turnEnd?.({ type: "turn_end", turnIndex: 1, outcome: "aborted" }, context())).toBeFalsy();
    // The next completed turn still appends (boundary not consumed by the abort).
    expect((await turnEnd?.({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).entries).toHaveLength(1);
  });

  it("reconstruction counter: a branch with k persisted sheets continues sessionTurnCount at k (Q3 marker integrity)", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:1");
    const turnEnd = handlers.get("turn_end");
    // Build a branch with k=3 pre-persisted sheets (simulating a resumed multi-invocation session).
    const sheet = (turnIndex: number) => ({
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: `Mini self-org workpad — history checkpoint (turn ${turnIndex})`,
      display: false,
      details: { snapshot: valid },
    });
    const branch = context([workpadEntry(TOOL_NAME, valid), sheet(1), sheet(2), sheet(3)]);
    await handlers.get("session_start")?.({}, branch);
    await tool.execute("id", valid);

    // The first new sheet continues the cumulative counter at k+1 = 4, not 1.
    const r1 = await turnEnd?.({ type: "turn_end", turnIndex: 4, outcome: "completed" }, branch);
    expect(r1.entries).toHaveLength(1);
    expect(r1.entries[0].content).toContain("Turn index: 4");
    expect(r1.entries[0].content).toContain("turn 4)");
  });

  // ── Composite mode: user-boundary+scheduled:N ──────────────────────────────

  it("composite: user-boundary+scheduled:3 — boundary-only turn does NOT reset scheduled cadence", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:2");
    const turnEnd = handlers.get("turn_end")!;
    await tool.execute("id", valid);

    // Arm the user boundary.
    await handlers.get("before_agent_start")?.({}, context());

    // Turn 1: boundary is due (pendingUserBoundary=true), scheduled counter=1 (not yet due).
    // Pad has content → boundary-only sheet. Scheduled counter is NOT reset (stays at 1).
    const r1 = await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    expect(r1.entries[0].content).toContain("Turn index: 1");

    // Turn 2: no new boundary (consumed), scheduled counter=2 (now due). Pad has content → scheduled sheet.
    const r2 = await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context());
    expect(r2.entries).toHaveLength(1);
    expect(r2.entries[0].content).toContain("Turn index: 2");
  });

  it("composite: scheduled-only due turn emits one sheet and resets only its window", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:3");
    const turnEnd = handlers.get("turn_end")!;
    await tool.execute("id", valid);

    // No before_agent_start → no boundary armed. Pure scheduled cadence.
    // Turns 1, 2: no sheet. Turn 3: scheduled due.
    expect(await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();
    expect(await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
    const r3 = await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(r3.entries).toHaveLength(1);

    // Window reset: turns 4, 5 no; turn 6 yes. This composite setup additionally proves the
    // scheduled cadence resets on its own emission even though a user-boundary trigger is
    // enabled (the atomic scheduled mode cannot be exercised this way).
    expect(await turnEnd({ type: "turn_end", turnIndex: 4, outcome: "completed" }, context())).toBeFalsy();
    expect(await turnEnd({ type: "turn_end", turnIndex: 5, outcome: "completed" }, context())).toBeFalsy();
    const r6 = await turnEnd({ type: "turn_end", turnIndex: 6, outcome: "completed" }, context());
    expect(r6.entries).toHaveLength(1);
    expect(r6.entries[0].content).toContain("Turn index: 6");
  });

  it("composite: simultaneous boundary+scheduled due emits exactly ONE sheet, resets cadence", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:2");
    const turnEnd = handlers.get("turn_end")!;
    await tool.execute("id", valid);

    // Arm boundary. Turn 1: counter=1, boundary armed. Not scheduled due yet (1<2).
    // Pad non-empty, boundary due → boundary-only sheet. Counter NOT reset (stays 1).
    await handlers.get("before_agent_start")?.({}, context());
    const r1 = await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    expect(r1.entries[0].content).toContain("Turn index: 1");

    // Turn 2: counter=2 (≥2, scheduled due), boundary consumed. Scheduled sheet.
    const r2 = await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context());
    expect(r2.entries).toHaveLength(1);

    // Now arm boundary again. Turn 3: counter=1, boundary armed, not scheduled due.
    // Boundary-only sheet (cadence NOT reset by boundary-only emission).
    await handlers.get("before_agent_start")?.({}, context());
    const r3 = await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(r3.entries).toHaveLength(1);

    // Turn 4: counter=2 (scheduled due), no boundary pending. Scheduled sheet, cadence reset.
    const r4 = await turnEnd({ type: "turn_end", turnIndex: 4, outcome: "completed" }, context());
    expect(r4.entries).toHaveLength(1);
    expect(r4.entries[0].content).toContain("Turn index: 4");
  });

  it("composite: simultaneous boundary+scheduled due coalesces to exactly ONE sheet (scheduled:1)", async () => {
    // scheduled:1 makes the scheduled trigger due on EVERY completed turn, so arming the
    // boundary guarantees a turn where BOTH triggers are simultaneously due.
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:1");
    const turnEnd = handlers.get("turn_end")!;
    await tool.execute("id", valid);
    await handlers.get("before_agent_start")?.({}, context());

    // Turn 1: counter=1 (≥1, scheduled due) AND boundary armed → both due → ONE coalesced sheet.
    const r1 = await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    expect(r1.entries[0].content).toContain("Turn index: 1");

    // Cadence reset: counter back to 0 → turn 2 counter=1, scheduled due again, no boundary → one sheet.
    const r2 = await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context());
    expect(r2.entries).toHaveLength(1);
  });

  it("composite: scheduled:1 + user-boundary — both always due, coalesces to exactly ONE sheet per turn", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:1");
    const turnEnd = handlers.get("turn_end")!;
    await tool.execute("id", valid);
    await handlers.get("before_agent_start")?.({}, context());

    // Turn 1: counter=1 (scheduled due), boundary armed → BOTH due. Exactly one sheet.
    const r1 = await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    expect(r1.entries[0].content).toContain("Turn index: 1");

    // Turn 2: counter=1 again (reset to 0 on turn 1, now 1 ≥ 1 → due). No boundary (consumed, not re-armed).
    const r2 = await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context());
    expect(r2.entries).toHaveLength(1);
  });

  it("composite: empty pad + boundary only → no emit, boundary preserved; later non-empty turn emits", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:3");
    const turnEnd = handlers.get("turn_end")!;

    // Arm boundary with empty pad.
    await handlers.get("before_agent_start")?.({}, context());

    // Turn 1: boundary due, pad empty → no emit. Boundary stays pending; the scheduled
    // counter advances (1 of 3) despite the empty pad.
    expect(await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();

    // Now populate the pad (within same agent loop, no re-arm).
    await tool.execute("id", valid);

    // Turn 2: boundary still pending, pad non-empty, scheduled counter=2 (not due) → deferred boundary sheet.
    const r2 = await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context());
    expect(r2.entries).toHaveLength(1);
    expect(r2.entries[0].content).toContain("Turn index: 2");

    // Turn 3: scheduled counter=3 → due; cadence was NOT reset by the turn-2 boundary sheet.
    const r3 = await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(r3.entries).toHaveLength(1);
    expect(r3.entries[0].content).toContain("Turn index: 3");
  });

  it("composite: empty pad + simultaneous boundary+scheduled → one nudge, cadence reset, boundary preserved", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:2");
    const turnEnd = handlers.get("turn_end")!;

    // Arm boundary. Pad is empty.
    await handlers.get("before_agent_start")?.({}, context());

    // Turn 1: counter=1, boundary due, scheduled not yet due. Empty pad → no emit.
    expect(await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();

    // Turn 2: counter=2 (scheduled due), boundary still pending. Empty pad → nudge.
    const r2 = await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context());
    expect(r2.entries).toHaveLength(1);
    expect(r2.entries[0].content).toContain("the workpad is empty");

    // Boundary was preserved (not cleared by the nudge). Populate the pad, complete the
    // next turn: counter is now 1 (< 2) so scheduled is not due, but boundary is still
    // pending and the pad has content → deferred boundary sheet emits.
    await tool.execute("id", valid);
    const r3 = await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(r3.entries).toHaveLength(1);
    expect(r3.entries[0].content).toContain("Turn index: 3");
    expect(r3.entries[0].content).not.toContain("the workpad is empty");
  });

  it("composite: aborted/errored turn_end advances nothing", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:2");
    const turnEnd = handlers.get("turn_end")!;
    await tool.execute("id", valid);
    await handlers.get("before_agent_start")?.({}, context());

    // Aborted: no counter advance, no boundary consumption.
    expect(await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "aborted" }, context())).toBeFalsy();
    // Errored: same.
    expect(await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "error" }, context())).toBeFalsy();
    // Completed: now counter=1, boundary still pending → boundary sheet.
    expect((await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).entries).toHaveLength(1);
  });

  it("composite: force (session_compact) with non-empty pad emits sheet; empty pad emits nudge + preserves boundary", async () => {
    // Non-empty pad: force → state sheet.
    const a = setupWithInjection("user-boundary+scheduled:5");
    await a.tool.execute("id", valid);
    await a.handlers.get("session_compact")?.({}, context());
    const rA = await a.handlers.get("turn_end")!({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(rA.entries).toHaveLength(1);
    expect(rA.entries[0].content).not.toContain("the workpad is empty");

    // Empty pad: force → nudge, boundary preserved.
    const b = setupWithInjection("user-boundary+scheduled:5");
    await b.handlers.get("before_agent_start")?.({}, context());
    await b.handlers.get("session_compact")?.({}, context());
    const rB = await b.handlers.get("turn_end")!({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(rB.entries).toHaveLength(1);
    expect(rB.entries[0].content).toContain("the workpad is empty");

    // Boundary still pending: populate pad, next turn emits boundary sheet.
    await b.tool.execute("id", valid);
    const rB2 = await b.handlers.get("turn_end")!({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context());
    expect(rB2.entries).toHaveLength(1);
    expect(rB2.entries[0].content).not.toContain("the workpad is empty");
  });

  it("composite: reconstruct initializes sessionTurnCount from persisted sheets (Q3 marker continuity)", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:3");
    const turnEnd = handlers.get("turn_end")!;
    const sheet = (turnIndex: number) => ({
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: `Mini self-org workpad — history checkpoint (turn ${turnIndex})`,
      display: false,
      details: { snapshot: valid },
    });
    const branch = context([workpadEntry(TOOL_NAME, valid), sheet(1), sheet(2)]);
    await handlers.get("session_start")?.({}, branch);
    await tool.execute("id", valid);

    // Force from reconstruct → first turn emits; counter should be 3 (2 persisted + 1).
    const r1 = await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, branch);
    expect(r1.entries).toHaveLength(1);
    expect(r1.entries[0].content).toContain("Turn index: 3");
  });

  it("atomic user-boundary: reconstruct initializes sessionTurnCount from persisted sheets (marker fix)", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary");
    const turnEnd = handlers.get("turn_end")!;
    const sheet = (turnIndex: number) => ({
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: `Mini self-org workpad — history checkpoint (turn ${turnIndex})`,
      display: false,
      details: { snapshot: valid },
    });
    const branch = context([workpadEntry(TOOL_NAME, valid), sheet(1), sheet(2)]);
    await handlers.get("session_start")?.({}, branch);
    await tool.execute("id", valid);

    // forceNextAppend is set by reconstruct; first completed turn emits with counter=3.
    const r1 = await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, branch);
    expect(r1.entries).toHaveLength(1);
    expect(r1.entries[0].content).toContain("Turn index: 3");
  });

  // ── User-Pinned Directive: reconstruction (spec §7) ──────────────────────

  it("reconstructs a pinned directive from a pin entry on session_start (pin → reload → restored)", async () => {
    const { handlers, commands } = setup();
    const branch = context([pinEntry("Never touch legacy DB tables")]);
    await handlers.get("session_start")?.({}, branch);
    const notify = vi.fn();
    await commands.get("mini-self-org").handler("", { ui: { notify } });
    const output = notify.mock.calls[0][0] as string;
    expect(output).toContain("[User directive] (set by user, immutable)");
    expect(output).toContain("Never touch legacy DB tables");
  });

  it("pin → unpin → pin: newest pin wins, unpin clears without resurrecting the stale pin", () => {
    // Newest entry wins unconditionally: a later unpin (null) clears even though an older pin exists.
    const cleared = reconstructUserDirective(context([pinEntry("Old guardrail"), pinEntry(null)]));
    expect(cleared).toBeNull();
    // A newer pin after the unpin restores the directive.
    expect(reconstructUserDirective(context([pinEntry("Old guardrail"), pinEntry(null), pinEntry("New guardrail")])))
      .toEqual({ text: "New guardrail", timestamp: 1 });
    // Only pins, newest wins.
    expect(reconstructUserDirective(context([pinEntry("First"), pinEntry("Second")])!)).toEqual({ text: "Second", timestamp: 1 });
    // No pin entries at all → null.
    expect(reconstructUserDirective(context([workpadEntry(TOOL_NAME, valid)]))).toBeNull();
  });

  it("sanitizes corrupted pin entries defensively (non-string, whitespace, >300 chars → null)", () => {
    expect(reconstructUserDirective(context([{ type: "custom", customType: USER_PIN_CUSTOM_TYPE, data: { text: 42, timestamp: 1 } }]))).toBeNull();
    expect(reconstructUserDirective(context([pinEntry("   ")]))).toBeNull();
    expect(reconstructUserDirective(context([pinEntry("x".repeat(301))]))).toBeNull();
    // Trimming is applied: "  keep it short  " → "keep it short".
    expect(reconstructUserDirective(context([pinEntry(" keep it short ")]))).toEqual({ text: "keep it short", timestamp: 1 });
    // Exactly 300 chars is allowed.
    expect(reconstructUserDirective(context([pinEntry("x".repeat(300))]))!.text).toHaveLength(300);
  });

  it("pin entries do not affect reconstructSnapshot, reconstructLastPersisted, or reconstructHistory", () => {
    const withPin = [workpadEntry(TOOL_NAME, valid), pinEntry("Guardrail"), pinEntry(null), pinEntry("Second")];
    const withoutPin = [workpadEntry(TOOL_NAME, valid)];
    expect(reconstructSnapshot(context(withPin))).toEqual(reconstructSnapshot(context(withoutPin)));
    const customSheet = { type: "custom_message", customType: WORKPAD_CUSTOM_TYPE, content: "sheet", display: false, details: { snapshot: valid } };
    expect(reconstructLastPersisted(context([pinEntry("G"), customSheet]))).toEqual(reconstructLastPersisted(context([customSheet])));
    expect(reconstructHistory(context([...withPin, customSheet]))).toEqual(reconstructHistory(context([...withoutPin, customSheet])));
  });

  // ── User-Pinned Directive: formatting (spec §3.2, §7) ────────────────────

  it("formatWorkpad: legacy exact format when no directive (non-empty and empty snapshot)", () => {
    const clean = { overallGoal: "Ship", currentFocus: "Test focus", nextActions: ["Test"], blockers: [], notes: ["Keep small"] };
    expect(formatWorkpad(clean)).toBe("Mini self-org workpad\nOverall goal: Ship\nCurrent focus: Test focus\nNext actions:\n- Test\nBlockers: [none]\nNotes:\n- Keep small");
    expect(formatWorkpad(emptySnapshot(), null)).toBe("Mini self-org workpad\nOverall goal: [none]\nCurrent focus: [none]\nNext actions: [none]\nBlockers: [none]\nNotes: [none]");
  });

  it("formatWorkpad: with active directive, directive block first; scratchpad header only for non-empty pad", () => {
    const directive = { text: "Backwards-compat with v1.", timestamp: 1 };
    const clean = { overallGoal: "Ship", currentFocus: "Focus", nextActions: ["A"], blockers: [], notes: [] };
    expect(formatWorkpad(clean, directive)).toBe(
      "Mini self-org workpad\n[User directive] (set by user, immutable):\nBackwards-compat with v1.\n\n[Agent scratchpad]\nOverall goal: Ship\nCurrent focus: Focus\nNext actions:\n- A\nBlockers: [none]\nNotes: [none]"
    );
    // Empty pad + directive: directive block without [Agent scratchpad] header.
    expect(formatWorkpad(emptySnapshot(), directive)).toBe(
      "Mini self-org workpad\n[User directive] (set by user, immutable):\nBackwards-compat with v1.\n\nOverall goal: [none]\nCurrent focus: [none]\nNext actions: [none]\nBlockers: [none]\nNotes: [none]"
    );
  });

  // ── User-Pinned Directive: workpad-get combined view (spec §3.2, §7) ─────

  it("workpad-get returns combined view after session_start reconstructs the directive", async () => {
    const { handlers, tools } = setup();
    const get = tools.get(WORKPAD_GET_TOOL_NAME);
    const branch = context([pinEntry("Never touch legacy DB tables")]);
    await handlers.get("session_start")?.({}, branch);
    const result = await get.execute("id", {});
    const text = result.content[0].text as string;
    expect(text).toContain("[User directive] (set by user, immutable)");
    expect(text).toContain("Never touch legacy DB tables");
  });

  // ── User-Pinned Directive: pinned text survives agent overwrites (spec §7) ─

  it("pinned directive survives agent self-org-workpad-set overwrite and full clear", async () => {
    const { handlers, tool, tools } = setup();
    const get = tools.get(WORKPAD_GET_TOOL_NAME);
    const branch = context([pinEntry("Keep guardrails on")]);
    await handlers.get("session_start")?.({}, branch);
    // Agent overwrites the snapshot with new content.
    await tool.execute("id", valid);
    let text = (await get.execute("id", {})).content[0].text as string;
    expect(text).toContain("Keep guardrails on");
    expect(text).toContain("Overall goal: Ship");
    // Agent fully clears the snapshot — directive remains.
    await tool.execute("id", emptySnapshot());
    text = (await get.execute("id", {})).content[0].text as string;
    expect(text).toContain("[User directive] (set by user, immutable)");
    expect(text).toContain("Keep guardrails on");
  });

  // ── User-Pinned Directive: unified sheet at turn_end (spec §3.3, §7) ─────

  it("unified sheet with active directive and non-empty pad: directive block + agent fields + R2 framing", async () => {
    const { handlers, tool } = setupWithInjection("scheduled:1");
    const turnEnd = handlers.get("turn_end")!;
    const branch = context([pinEntry("Backwards-compat with v1.")]);
    await handlers.get("session_start")?.({}, branch);
    await tool.execute("id", valid);
    const r1 = await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    const content = r1.entries[0].content as string;
    expect(content).toContain("Mini self-org workpad — history checkpoint (turn 1)");
    expect(content).toContain("[USER DIRECTIVE] (Authoritative, set by human user — immutable)");
    expect(content).toContain("Backwards-compat with v1.");
    expect(content).toContain("[AGENT WORKING STATE]");
    expect(content).toContain("Overall goal: Ship");
    expect(content).toContain("Turn index: 1");
    expect(content).toContain("Later tool activity may supersede this");
    expect(r1.entries[0].details.snapshot).toEqual({ overallGoal: "Ship", currentFocus: "Test focus", nextActions: ["Test"], blockers: [], notes: ["Keep small"] });
  });

  it("empty pad + active directive + scheduled due: unified sheet with empty-scratchpad note (NOT the nudge)", async () => {
    const { handlers } = setupWithInjection("scheduled:2");
    const turnEnd = handlers.get("turn_end")!;
    const branch = context([pinEntry("Keep guardrails on")]);
    await handlers.get("session_start")?.({}, branch);
    // Force from reconstruct → first completed turn emits the unified directive-only sheet.
    const r1 = await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    const content = r1.entries[0].content as string;
    expect(content).toContain("[USER DIRECTIVE]");
    expect(content).toContain("The agent's scratchpad is currently empty.");
    expect(content).not.toContain("the workpad is empty");
    expect(r1.entries[0].details).toEqual({});
    // Window reset: turn 2 counter=1 < 2 → no emit.
    expect(await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
    // Turn 3 counter=2 → scheduled due → directive sheet again (still no nudge).
    const r3 = await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(r3.entries).toHaveLength(1);
    expect(r3.entries[0].content as string).not.toContain("the workpad is empty");
    expect(r3.entries[0].content as string).toContain("The agent's scratchpad is currently empty.");
  });

  it("user-boundary + directive + empty pad: sheet emitted and boundary CONSUMED; next turn without new boundary does not re-emit", async () => {
    const { handlers } = setupWithInjection("user-boundary");
    const turnEnd = handlers.get("turn_end")!;
    const branch = context([pinEntry("Never force-push")]);
    await handlers.get("session_start")?.({}, branch);
    await handlers.get("before_agent_start")?.({}, context());
    // First completed turn: boundary due, directive active, pad empty → unified sheet, boundary consumed.
    const r1 = await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(r1.entries).toHaveLength(1);
    expect((r1.entries[0].content as string)).toContain("[USER DIRECTIVE]");
    // Second completed turn in same loop: boundary consumed, nothing due → no emit (no per-turn spam).
    expect(await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
    // Re-arm: boundary due again → emit again.
    await handlers.get("before_agent_start")?.({}, context());
    expect((await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context())).entries).toHaveLength(1);
  });

  it("no directive, empty pad, no trigger due: nothing emitted (unchanged); nudge unchanged for scheduled due", async () => {
    const { handlers } = setupWithInjection("user-boundary+scheduled:3");
    const turnEnd = handlers.get("turn_end")!;
    await handlers.get("before_agent_start")?.({}, context());
    // Boundary-only due, empty pad, no directive → no emit, boundary preserved.
    expect(await turnEnd({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context())).toBeFalsy();
    expect(await turnEnd({ type: "turn_end", turnIndex: 2, outcome: "completed" }, context())).toBeFalsy();
    // Scheduled due on turn 3 → nudge (no directive active).
    const r3 = await turnEnd({ type: "turn_end", turnIndex: 3, outcome: "completed" }, context());
    expect(r3.entries).toHaveLength(1);
    expect((r3.entries[0].content as string)).toContain("the workpad is empty");
    expect(r3.entries[0].details).toEqual({});
  });

  // ── User-Pinned Directive: commands (spec §4, §7) ─────────────────────────

  it("registers separate, discoverable user-pin and user-unpin commands", () => {
    const { commands } = setup();
    expect(commands.get("mini-self-org-user-pin").description).toContain("user-pinned directive");
    expect(commands.get("mini-self-org-user-unpin").description).toContain("user-pinned directive");
  });

  it("/mini-self-org-user-pin preserves internal whitespace and multiline text after outer trim", async () => {
    const { pi, commands } = setup();
    const appendSpy = (pi as any).appendEntry;
    const notify = vi.fn();
    const ctx = { hasUI: false, ui: { notify }, sessionManager: { getBranch: () => [] } };
    await commands.get("mini-self-org-user-pin").handler("  line one\nline  two  ", ctx);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy.mock.calls[0][1].text).toBe("line one\nline  two");
    expect(notify).toHaveBeenCalledWith(formatWorkpad(emptySnapshot(), { text: "line one\nline  two", timestamp: expect.any(Number) }), "info");
  });

  it("pin and unpin show the combined view while preserving a non-empty agent scratchpad", async () => {
    const { commands, tool } = setup();
    await tool.execute("id", valid);
    const notify = vi.fn();
    const ctx = { ...commandCtx(), ui: { notify } };
    await commands.get("mini-self-org-user-pin").handler("Keep v1 compatibility", ctx);
    expect(notify).toHaveBeenLastCalledWith(formatWorkpad({ overallGoal: "Ship", currentFocus: "Test focus", nextActions: ["Test"], blockers: [], notes: ["Keep small"] }, { text: "Keep v1 compatibility", timestamp: expect.any(Number) }), "info");
    await commands.get("mini-self-org-user-unpin").handler("", ctx);
    expect(notify).toHaveBeenLastCalledWith(formatWorkpad({ overallGoal: "Ship", currentFocus: "Test focus", nextActions: ["Test"], blockers: [], notes: ["Keep small"] }), "info");
  });

  it("/mini-self-org-user-pin stores a directive and forces the next persistent injection", async () => {
    const { pi, commands, handlers } = setupWithInjection("scheduled:5");
    const appendSpy = (pi as any).appendEntry;
    const notify = vi.fn();
    await commands.get("mini-self-org-user-pin").handler("Never touch legacy DB tables", { ...commandCtx(), ui: { notify } });
    expect(appendSpy.mock.calls[0][0]).toBe(USER_PIN_CUSTOM_TYPE);
    expect(appendSpy.mock.calls[0][1].text).toBe("Never touch legacy DB tables");
    const result = await handlers.get("turn_end")!({ type: "turn_end", turnIndex: 1, outcome: "completed" }, context());
    expect(result.entries[0].content).toContain("Never touch legacy DB tables");
  });

  it("/mini-self-org-user-pin prompts interactively and rejects missing or oversized text", async () => {
    const { pi, commands } = setup();
    const appendSpy = (pi as any).appendEntry;
    const input = vi.fn().mockResolvedValue("  From the prompt  ");
    const notify = vi.fn();
    await commands.get("mini-self-org-user-pin").handler("", { hasUI: true, ui: { input, notify }, sessionManager: { getBranch: () => [] } });
    expect(appendSpy.mock.calls[0][1].text).toBe("From the prompt");
    await commands.get("mini-self-org-user-pin").handler("", { ...commandCtx({ notify }), hasUI: false });
    expect(notify.mock.calls[1][0]).toContain("argument required, no interactive UI available");
    await commands.get("mini-self-org-user-pin").handler("x".repeat(301), { ...commandCtx({ notify }), hasUI: false });
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[2][0]).toContain("300");
  });

  it("/mini-self-org-user-unpin clears the directive and rejects arguments", async () => {
    const { pi, commands } = setup();
    const appendSpy = (pi as any).appendEntry;
    const notify = vi.fn();
    await commands.get("mini-self-org-user-unpin").handler("unexpected", { ...commandCtx(), ui: { notify } });
    expect(appendSpy).not.toHaveBeenCalled();
    expect(notify.mock.calls[0][0]).toBe("Usage: /mini-self-org-user-unpin");
    await commands.get("mini-self-org-user-unpin").handler("", { ...commandCtx(), ui: { notify } });
    expect(appendSpy.mock.calls[0]).toEqual([USER_PIN_CUSTOM_TYPE, expect.objectContaining({ text: null })]);
    expect(notify).toHaveBeenLastCalledWith(formatWorkpad(emptySnapshot()), "info");
  });

  it("/mini-self-org remains view-only and directs legacy subcommands to the new commands", async () => {
    const { commands } = setup();
    const notify = vi.fn();
    await commands.get("mini-self-org").handler("pin Old guardrail", { ...commandCtx(), ui: { notify } });
    expect(notify.mock.calls[0][0]).toContain("/mini-self-org-user-pin");
    const view = vi.fn();
    await commands.get("mini-self-org").handler("", { ...commandCtx(), ui: { notify: view } });
    expect(view.mock.calls[0][0]).toBe(formatWorkpad(emptySnapshot()));
  });

  it("composite: context hook remains strip-only", async () => {
    const { handlers, tool } = setupWithInjection("user-boundary+scheduled:3");
    const contextHandler = handlers.get("context")!;
    await tool.execute("id", valid);
    const stale = { role: "custom", customType: WORKPAD_CUSTOM_TYPE, content: "old", display: false, timestamp: 1 };
    const user = { role: "user", content: "keep", timestamp: 1 };
    expect(await contextHandler({ messages: [user, stale] }, context())).toEqual({ messages: [user] });
    expect((await contextHandler({ messages: [] }, context())).messages).toEqual([]);
  });
});
