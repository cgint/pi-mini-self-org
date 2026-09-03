# Plan: Distinguish "rejected" from "cleared" in the workpad TUI rendering

Status: **implemented 2026-09-03** (supervised sub-agent; lead-verified: diff inspected, `npm test` 19/19, typecheck clean) — automated checks done; optional manual verification steps 2–3 (live session, OptimusTower replay) still open
Scope: `src/mini-self-org.ts` (+~15 lines), `test/mini-self-org.test.ts` (+2 tests). No schema or workpad state-semantics changes; the only user-visible change is the TUI line for rejected calls.

## Problem

A **rejected** workpad update (harness schema validation failure, or the extension's own
`execute`-level rejection) renders in the TUI as:

```
Cleared — no context will be injected.
```

which is what a deliberate, *successful* clear looks like. The line is not just ambiguous —
it is a **false statement**: on a rejected call the previous snapshot is still active and
still injected before every LLM call, yet the user is told no context will be injected.

## Evidence

Session: `~/dev-private/OptimusTower/AI-Partner/.pi_sessions/2026-09-03T12-48-56-364Z_01a06750-b02c-700c-9796-18535563980f.jsonl`

- Line 144: tool call with malformed payload — `nextActions` item is a nested array,
  `notes` is a JSON-encoded string (despite the tool description warning).
- Line 145: `toolResult`, `isError: true`, `details: {}` (no `snapshot` key), content =
  `Validation failed for tool "mini-self-org-workpad": - nextActions.0: must be string …`.
  The TUI rendered this entry as "Cleared — no context will be injected."
- The session contained **15 workpad calls: 14 successful, 1 rejected, 0 clears** —
  the "Cleared" line corresponded to the only failure.
- Line 146/147: model retried with corrected payload; success.

The string "Cleared — no context will be injected." exists **only** in this extension
(`renderCleared()` in `src/mini-self-org.ts`).

## Root-cause chain (all steps verified)

1. Model emits tool call with invalid arguments.
2. Harness validates against the TypeBox schema **before** `execute()`
   (`pi-coding-agent/dist/bundle/chunks/chunk-OMWWHBTG.js` @ ~1.44M):
   `validator.Check(args)` fails → `throw new Error("Validation failed for tool …: …  Received arguments: …")`.
   The extension's `execute()`/`sanitizeSnapshot()` **never runs**.
3. Agent loop persists `toolResult` message: `content=[error text]`, `isError: true`,
   `details: {}`.
4. TUI `ToolExecutionComponent.updateResult({content, details?, isError})` stores it and
   builds the render context with `isError: this.result?.isError ?? false`
   (`dist/modes/interactive/components/tool-execution.js:105`).
   `ToolRenderContext.isError` is documented: "Whether the current result is an error."
5. Extension `renderResult(result)` destructures **only arg 1**, ignores `context` →
   reads `result.details?.snapshot` → missing → `sanitizeSnapshot(undefined)` →
   falls through to `renderCleared()` → false "Cleared" line.

### Key type facts (decide the fix shape)

- `AgentToolResult<T>` (the `result` param) has **no** `isError` — only
  `content`, `details`, `usage?`, `addedToolNames?`
  (`pi-agent-core/dist/types.d.ts` ~L317).
- `ToolRenderContext` (arg 4 of `renderResult`) **has** `isError: boolean`
  (`pi-coding-agent/dist/core/extensions/types.d.ts` L315–338).
  → The distinguishing signal is already delivered to the extension; it is just unused.
  (Component-level verified at tool-execution.js:105; the agent-loop → component wiring is assumed
  standard. The OptimusTower incident proves `renderResult` runs for rejected entries live, and
  manual verification step 2 confirms the flag end-to-end.)

## Fix design

In `src/mini-self-org.ts`, workpad tool `renderResult`:

```ts
renderResult(result, _options, _theme, context) {
  if (context.isError) return renderRejected(result);
  const snapshot = sanitizeSnapshot((result.details as WorkpadDetails | undefined)?.snapshot);
  return snapshot && hasContent(snapshot) ? renderSnapshot(snapshot) : renderCleared();
}
```

New component:

```ts
function renderRejected(result: AgentToolResult<WorkpadDetails>): StructuralComponent {
  const text = (result.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
  // Best-effort detail line: prefer the first harness error item ("  - …"); fall back to the first non-empty line.
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
```

(`AgentToolResult` is exported by `pi-coding-agent`; the detail-line extraction is best-effort against the
harness message format, which can change — the fallback keeps rendering safe.)

(Wording may be refined; the contract is: never show "Cleared" for an error, and state
that the previous snapshot is still active.)

### Coverage

| Case | `details.snapshot` | `context.isError` | Render |
|---|---|---|---|
| Successful update | present, content | false | `renderSnapshot` (unchanged) |
| Successful clear | present, empty | false | `renderCleared` (unchanged) |
| Harness validation failure | absent | **true** | `renderRejected` (new) |
| Extension self-rejection (`execute` returns `isError`) | absent | **true** | `renderRejected` (new) |
| Session replay of any of the above | as persisted | from persisted message | follows the message — [assumed]: component API + HTML export pass `msg.isError`, but the TUI replay wiring is untraced; covered by verification step 3 |

## Test plan (`test/mini-self-org.test.ts`)

- New test 1 (self-rejection): take an actually rejected result
  (`await tool.execute("id", { ...valid, blockers: ["a","b","c"] })`, i.e. `isError: true`,
  `details: {}`) and assert
  `tool.renderResult(rejected, {}, {}, { isError: true })` renders the rejected line.
- New test 2 (harness-shape, the primary incident): hand-craft the result
  (`{ content: [{ type: "text", text: "Validation failed for tool \"…\":\n  - nextActions.0: must be string\n…" }], details: {} }`)
  and render with `{ isError: true }` — assert the `  - ` error item line is shown. `execute()` cannot
  produce this shape because harness validation happens before `execute()`.
- Existing tests stay green unchanged: all current `renderResult` calls pass `{}` as the
  context arg → `isError` undefined → falsy → snapshot/cleared path untouched
  (notably "clearly renders and reports clearing", ~L103, and the truncation test, ~L111).

## Verification after implementation

1. `npm test` (vitest) + `npm run typecheck`.
2. Manual: in a live pi session with the extension, emit a deliberately malformed
   workpad call (e.g. `nextActions: [["x"]]`) → TUI must show the Rejected line, not "Cleared".
3. Manual: resume the OptimusTower session above → line 145 should re-render as Rejected.
   (Confirms the replay path end-to-end.)

## Explicitly out of scope (follow-ups, separate decisions)

1. **Reason-bearing error in `sanitizeSnapshot`** — only reachable for trim-only-whitespace
   items today (schema rejects first for everything else); near-dead code path.
2. **Rejected markers in `mini-self-org-history`** — `reconstructHistory` could count
   entries where `message.isError` is true and render `[hh:mm] — rejected`; small, optional.
3. **Semantic misuse: "Done:" items in `nextActions`** — observed in the same session
   (workpad used as a completion log); a description/tuning question, not a code fix.
4. **Harness single-error surfacing** — the bundled harness TypeBox reported only
   `nextActions.0` while the project's TypeBox 0.34 reports both defects
   (`/nextActions/0: Expected string`, `/notes: Expected array`); the bundle ships a
   different build (wording differs). **Unverified** why only one error surfaced; low
   impact because "Received arguments:" echoes the full payload and enabled self-correction.
5. **`prepareArguments` repair shim** — `ToolDefinition` offers a documented pre-validation shim
   ("prepare raw tool call arguments before schema validation"); it could coerce JSON-encoded string
   lists into arrays and unwrap nested-array items, eliminating this malformation class at the source.
   Trade-off: silently mutates the model's payload vs. the honest fast-retry-with-precise-error path
   that already worked in the incident. Needs its own decision if pursued.

## Files touched (planned)

- `src/mini-self-org.ts` — `renderResult` branch + `renderRejected` component.
- `test/mini-self-org.test.ts` — two new render-rejection tests (self-rejection via `execute` + hand-crafted harness-shape result).
- `README.md` — optional one-liner documenting the three render states (updated / cleared / rejected).
