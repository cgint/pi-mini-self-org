# 3 · Plan: user-pin-submit

> This plan has two parts. **Part A (Implemented baseline)** describes what is
> already shipped. **Part B (Pending: turn-1 guardrail bridge)** is the
> remaining work. The two are distinct — do not read them as contradictory
> alternatives; B is the delta on top of A.

## Part A — Implemented baseline

All changes in `src/mini-self-org.ts`. The `pin-submit` command reuses the
existing pin persistence path and adds a `pi.sendUserMessage` call after
persistence.

### A.1 Command Registration

```
/mini-self-org-user-pin-submit [text]
```

- Extract `text` from arguments (same parsing as `pin`).
- No argument + `ctx.hasUI` → interactive prompt (`ctx.ui.input`); on cancel, return.
- No argument + `!ctx.hasUI` → notify usage error, return.

### A.2 Shared handler logic

```
handlePinSubmit(rawText, ctx, pi):
  1. If rawText is null:
       if ctx.hasUI:
         text = await ctx.ui.input("Pin directive:", …); on null → return
       else:
         ctx.ui.notify("Usage: /mini-self-org-user-pin-submit <text> (no interactive UI)"); return
  2. text = rawText?.trim() ?? ""
  3. if text is empty → notify "nothing to pin", return
  4. if text.length > 300 → notify length error, return
  5. pi.appendEntry(USER_PIN_CUSTOM_TYPE, { text, timestamp: Date.now() })
  6. userDirective = { text, timestamp }; forceNextAppend = true
  7. ctx.ui.notify(combineWorkpad(display))
  8. If ctx.isIdle():
       pi.sendUserMessage(text, { expandPromptTemplates: false })
     Else:
       pi.sendUserMessage(text, { deliverAs: "followUp", expandPromptTemplates: false })
```

- Steps 1–7 mirror the existing `pin` handler (shared/identical logic).
- Step 8 is the **only new logic** — the idle/busy routing.
- `expandPromptTemplates: false` → text sent verbatim, not re-dispatched as a command/template.
- `deliverAs: "followUp"` (busy) queues after the in-flight turn, avoiding the SDK throw for a bare streaming submit.

### A.3 No changes to

- `WorkpadSnapshot` / `WorkpadParameters` — agent tool schema unchanged.
- `reconstructUserDirective` — pin-submit writes the same entry type.
- `formatWorkpad` — combined display is the same as `pin`.
- `turn_end` emission gate — no new trigger type; `forceNextAppend` already covered.

## Part B — Pending: turn-1 guardrail-framing bridge

Goal: make the directive's *standing-invariant status* visible on the submitted
turn (turn 1), not just from turn 2 (when the `turn_end` sheet is appended).

### B.1 Mechanism

Inject the directive's supreme-invariant framing into the LLM context of the
turn that pin-submit starts. Use a `display: false` message with a customType
**distinct** from `WORKPAD_CUSTOM_TYPE` (the context strip filter removes only
`WORKPAD_CUSTOM_TYPE`; a distinct type keeps the transient directive visible to
the LLM and non-persisted). Two viable carriers (dev team's choice):

- `before_agent_start` returning `{ message: { … } }` (non-persisted, in-memory), **or**
- `pi.sendMessage(…, { deliverAs: "nextTurn" })`.

### B.2 Disarm timing (correctness constraint)

The bridge fires for **exactly one agent turn** (the submitted turn). Disarm it
**on the next turn boundary**, *not* coupled to "a sheet was appended" — in
`never`-injection-policy mode no sheet is ever appended, so a
sheet-append-only disarm never fires and the bridge re-injects every turn.

### B.3 Shared invariant text

Extract the supreme-invariant directive block so `historySheetBody` (turn 2+
sheet) and the turn-1 bridge share the same builder. Do not duplicate the
string — turn 1 and turn 2 must show the LLM the *same* framing.

### B.4 Guidelines (informational, not mandatory)

The dev team owns the implementation. Worth knowing, not prescriptive:

- **Single-source the pin logic.** Keep the 300-char cap and pin commit shared
  between `pin` and `pin-submit` so they can't drift. How (helper, duplication,
  …) is up to the team.
- **Disarm on the next turn, not on sheet-append** (see B.2).
- **Don't duplicate the supreme-invariant text** (see B.3).
- **The bridge's customType should differ from `WORKPAD_CUSTOM_TYPE`** (see B.1).

## Test coverage plan (`test/mini-self-org.test.ts`)

**Part A (implemented — already covered):**
- Idle → `sendUserMessage(text, { expandPromptTemplates: false })`; `appendEntry` + `forceNextAppend` armed.
- Busy → `sendUserMessage(text, { deliverAs: "followUp" })`.
- Empty / whitespace → no `appendEntry`, no `sendUserMessage`, notify.
- >300 chars → no `appendEntry`, no `sendUserMessage`, notify.
- No-arg + `hasUI` → `ui.input` called, then persist + submit.
- No-arg + `!hasUI` → no `appendEntry`, no `sendUserMessage`, usage notify.

**Part B (pending — to add):**
- Turn-1 bridge: the submitted turn's LLM context includes the directive framed
  as the standing guardrail; content matches the shared `historySheetBody`
  block.
- Turn-2 disarm: after the submitted turn completes, the bridge is **not**
  re-injected on the next agent turn — including under `never`-injection-policy.
  This regression catches a sheet-append-only disarm.
- Reconstruction: a pin-submit entry is read by `reconstructUserDirective` like
  any pin (newest wins).
- Regression: existing pin/unpin/display/history command tests still pass.

## Risks / mitigations (Part B)

- **Duplicate directive block on turn 2** — disarm on the next turn (not
  sheet-append). Regression test asserts no re-emission on turn 2 and under
  `never`-policy.
- **`never`-policy infinite re-fire** — no sheet is appended in `never` mode;
  turn-based disarm avoids it (see B.2).
- **Context strip filter collision** — distinct customType keeps the transient
  directive visible and non-persisted (see B.1).
- **Framing drift turn 1 vs turn 2** — shared invariant-text builder (see B.3).
- **Shared-logic refactor** — keep the existing `pin` handler behavior
  byte-identical; regression tests guard it.
