# 3 · Plan: user-pin-submit

## Technical Architecture & Integration Points

All changes are in `src/mini-self-org.ts`. The `pin-submit` command reuses the
existing pin persistence path and adds a `pi.sendUserMessage` call after
persistence.

### 1. Command Registration

Register the new command alongside the existing `pin` / `unpin` handlers:

```
/mini-self-org-user-pin-submit [text]
```

- Extract `text` from arguments (same parsing as `pin`).
- Route to the shared `handlePinSubmit(text | null, ctx, pi)` function.

### 2. Shared `handlePinSubmit` Logic

```
handlePinSubmit(rawText, ctx, pi):
  1. If rawText is null:
       if ctx.hasUI:
         text = await ctx.ui.input("Pin directive:", ...)
         if text is null → return (user cancelled)
       else:
         ctx.ui.notify("Usage: /mini-self-org-user-pin-submit <text> (no interactive UI)")
         return
  2. text = rawText?.trim() ?? ""
  3. if text is empty → notify "nothing to pin", return
  4. if text.length > 300 → notify length error, return
  5. pi.appendEntry(USER_PIN_CUSTOM_TYPE, { text, timestamp: Date.now() })
  6. forceNextAppend = true
  7. ctx.ui.notify(combineWorkpad(display))  // show directive + scratchpad
  8. If ctx.isIdle():
       pi.sendUserMessage(text, { expandPromptTemplates: false })
     Else:
       pi.sendUserMessage(text, { deliverAs: "followUp" })
```

Key points:
- Steps 1–7 are identical to the existing `pin` handler (can be refactored into
  a shared helper if the `pin` handler is updated too).
- Step 8 is the **only new logic** — the idle/busy routing.
- `expandPromptTemplates: false` ensures the directive text is sent verbatim,
  not interpreted as a prompt template.
- `deliverAs: "followUp"` queues the message after the in-flight turn when the
  session is busy, preventing a race.

### 3. `forceNextAppend` Arming

- Set `forceNextAppend = true` after successful persistence (same as `pin`).
- No-op in `never` mode (existing guard applies).
- This ensures the next `turn_end` emits the unified sheet including the
  newly-pinned directive.

### 4. No Changes to

- `WorkpadSnapshot` / `WorkpadParameters` — agent tool schema unchanged.
- `reconstructUserDirective` — pin-submit writes the same entry type.
- `formatWorkpad` — combined display is the same as `pin`.
- Emission gate logic in `turn_end` — no new trigger type; `forceNextAppend`
  already covered.

## Test Plan

Tests go in `test/mini-self-org.test.ts`. The 5 test cases for `pin-submit`:

### 1. Idle → `sendUserMessage` with `expandPromptTemplates: false`

- Mock `ctx.isIdle()` → `true`.
- Call `handlePinSubmit("Do not touch the DB schema", ctx, pi)`.
- Assert:
  - `pi.appendEntry` called with `USER_PIN_CUSTOM_TYPE` and correct data.
  - `pi.sendUserMessage` called with `("Do not touch the DB schema", { expandPromptTemplates: false })`.
  - `ctx.ui.notify` called with combined workpad containing the directive.

### 2. Busy → `sendUserMessage` with `deliverAs: "followUp"`

- Mock `ctx.isIdle()` → `false`.
- Call `handlePinSubmit("Maintain v1 API compatibility", ctx, pi)`.
- Assert:
  - `pi.appendEntry` called correctly.
  - `pi.sendUserMessage` called with `("Maintain v1 API compatibility", { deliverAs: "followUp" })`.
  - `ctx.ui.notify` called with combined workpad.

### 3. Validation Error Handling

- **Empty text:** `handlePinSubmit("   ", ctx, pi)` →
  - `pi.appendEntry` **not** called.
  - `pi.sendUserMessage` **not** called.
  - `ctx.ui.notify` called with "nothing to pin" message.
- **Oversize text (> 300 chars):** `handlePinSubmit("a".repeat(301), ctx, pi)` →
  - `pi.appendEntry` **not** called.
  - `pi.sendUserMessage` **not** called.
  - `ctx.ui.notify` called with length error message.

### 4. Interactive UI Fallback

- **`hasUI = true`, no argument:**
  - Mock `ctx.ui.input` to return `"Use strict TypeScript"`.
  - Call `handlePinSubmit(null, ctx, pi)`.
  - Assert: `ctx.ui.input` called, then `pi.appendEntry` + `pi.sendUserMessage`
    called with the prompted text.
- **`hasUI = false`, no argument:**
  - Call `handlePinSubmit(null, ctx, pi)`.
  - Assert: `pi.appendEntry` **not** called, `pi.sendUserMessage` **not**
    called, `ctx.ui.notify` called with usage error.

### 5. `forceNextAppend` Arming

- Call `handlePinSubmit("Guardrail text", ctx, pi)`.
- Assert: after the call, the internal state has `forceNextAppend === true`.
- (In `never` mode: assert `forceNextAppend` remains unchanged / no effect.)
- This ensures the next `turn_end` will emit the unified sheet with the
  newly-pinned directive.

## Documentation Updates

Update `README.md` to include:

- **Command reference:** Add `/mini-self-org-user-pin-submit` to the commands
  table with its syntax, arguments, and behaviour.
- **Passive vs. Active pin:** Add a short section or table contrasting
  `pin` (passive, no turn trigger) vs `pin-submit` (active, immediate turn).
- **Directive semantics:** Note that `pin-submit` sets the directive and
  immediately triggers a turn; the agent acts on the directive from that turn
  onward.
- **Injection behaviour:** Note that `pin-submit` arms `forceNextAppend` the
  same way as `pin`/`unpin`, so the unified sheet is emitted on the next
  completed turn.
