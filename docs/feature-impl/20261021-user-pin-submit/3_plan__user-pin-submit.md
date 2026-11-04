# 3 · Plan: user-pin-submit

> This plan documents the **implemented** behaviour (Part A) and records the
> **not-adopted** optional refinement (Part B, out of scope) so it is not
> re-opened as missing work.

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

## Part B — Not adopted: turn-1 guardrail-framing bridge (OUT OF SCOPE)

> **This was considered and deliberately not built.** The feature is complete
> without it: the directive's status is set in the workpad immediately on
> pin/submit, and the agent reads it on the next completed turn (cadence /
> forced-append controlled). Showing the standing-rule *status* on the
> submitted turn itself was an optional refinement that was **not** adopted.
> Do not implement this unless explicitly re-scoped.

### Why it was not needed

The perceived "gap" was a misreading: the status is *set* immediately; only
*visibility* waits for the next cadence tick, and the pin's `forceNextAppend`
already pulls that to the next completed turn — one turn, independent of any
slow cadence (e.g. `scheduled:10`). That one-turn-later visibility is by
design and acceptable.

### If it were ever re-scoped (record only — do not act)

- Inject the supreme-invariant framing into the submitted turn via a
  `display:false` message with a customType **distinct** from
  `WORKPAD_CUSTOM_TYPE` (`before_agent_start` returned message, or
  `pi.sendMessage(…, {deliverAs:"nextTurn"})`).
- Disarm on the **next turn boundary**, not on sheet-append (in `never`
  -injection mode no sheet is ever appended; a sheet-append-only disarm would
  re-inject every turn forever).
- Share the invariant-text builder with `historySheetBody` so turn 1 and the
  forced sheet show identical framing.

## Test coverage plan (`test/mini-self-org.test.ts`)

**Part A (implemented — covered):**
- Idle → `sendUserMessage(text, { expandPromptTemplates: false })`; `appendEntry` + `forceNextAppend` armed.
- Busy → `sendUserMessage(text, { deliverAs: "followUp" })`.
- Empty / whitespace → no `appendEntry`, no `sendUserMessage`, notify.
- >300 chars → no `appendEntry`, no `sendUserMessage`, notify.
- No-arg + `hasUI` → `ui.input` called, then persist + submit.
- No-arg + `!hasUI` → no `appendEntry`, no `sendUserMessage`, usage notify.
- Regression: existing pin/unpin/display/history command tests still pass.

## Risks / mitigations

- **No Part B risks (not adopted).** The only residual note: if anyone later
  re-scopes the turn-1 bridge, the three constraints in Part B (distinct
  customType, turn-boundary disarm not sheet-append, shared invariant text)
  are the things to honor to avoid the `never`-policy infinite re-fire.
