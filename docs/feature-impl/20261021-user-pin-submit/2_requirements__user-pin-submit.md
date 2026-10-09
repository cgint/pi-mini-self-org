# 2 · Requirements: user-pin-submit

## Overview

`/mini-self-org-user-pin-submit` is an **active** directive command. It sets
the user-pinned directive (identical persistence to `pin`) **and** immediately
triggers an agent turn by submitting the directive text as a user-role message.

This closes the gap where a standing guardrail had to be set via `pin` and then
a separate user prompt was needed to make the agent act on it.

## Commands

| Invocation | Action |
|---|---|
| `/mini-self-org-user-pin-submit <text>` | Validate, persist the directive, display the combined workpad, and immediately trigger an agent turn with the directive text. |
| `/mini-self-org-user-pin-submit` (no text) | If `ctx.hasUI`, open an interactive prompt (`ctx.ui.input`) to collect the directive text, then perform the same persist + display + trigger flow. If `!ctx.hasUI`, notify a usage error and do nothing. |

> The interactive `ui.input` fallback **is** a requirement (matches the shipped
> code). It is consistent with plain `pin`'s no-argument behaviour.

## Validation

Applied to the directive text (after trim):

| Rule | Behaviour on failure |
|---|---|
| Trimmed text must be non-empty | Notify `"Nothing to pin"`. No entry written, no turn triggered. |
| Trimmed text must be ≤ 300 characters | Notify a length-exceeded error with the limit. No entry written, no turn triggered. |
| Multiline text | Allowed after trim. Must not break the sheet header layout. |

## Semantics (implemented baseline)

1. **Persistence:** Identical to `pin`. Calls
   `pi.appendEntry(USER_PIN_CUSTOM_TYPE, { text, timestamp: Date.now() })`.
   The directive is stored as a `CustomEntry` in the session branch tree,
   excluded from model context, invisible to agent tools.
2. **Force re-injection:** Sets `forceNextAppend = true` (no-op in `never`
   mode). This ensures the unified sheet including the new directive is emitted
   on the next completed turn.
3. **Display:** Shows the combined workpad (User Directive + Agent Scratchpad)
   via `ctx.ui.notify`, same as `pin`.
4. **Immediate turn trigger:** Calls `pi.sendUserMessage` with the directive
   text as the user-role message, routing by session state (see below).

## Execution Routing (implemented)

The turn is triggered **after** persistence succeeds:

| Session state | Call |
|---|---|
| Idle (`ctx.isIdle()` → `true`) | `pi.sendUserMessage(text, { expandPromptTemplates: false })` |
| Busy / streaming (`ctx.isIdle()` → `false`) | `pi.sendUserMessage(text, { deliverAs: "followUp" })` |

- `expandPromptTemplates: false` ensures the text is sent verbatim, not
  interpreted as a prompt template.
- `deliverAs: "followUp"` queues the message after the in-flight turn instead
  of racing it (avoids the SDK throw for a bare streaming submit).

## Pending requirement: turn-1 guardrail framing

The text being the user message is *not* sufficient — the LLM must also see it
framed as the standing supreme invariant **on the submitted turn itself** (turn
1). Currently the invariant framing only enters context at the `turn_end` sheet
(turn 2+).

**Requirement:** on the submitted turn, the LLM context includes the directive
framed as the standing guardrail, and the framing is **not** re-injected on the
next turn (no duplicate directive block once the sheet is appended). This is
met by a `before_agent_start` transient-directive bridge that fires for exactly
one agent turn and disarms on the next turn boundary.

> This is **not yet implemented** (see idea §Implementation status).

## Comparison: `pin` (passive) vs `pin-submit` (active)

| | `/mini-self-org-user-pin` (passive) | `/mini-self-org-user-pin-submit` (active) |
|---|---|---|
| **Intended use** | Standing constraint for future turns. | Standing constraint that should immediately drive the agent's next action. |
| **Turn triggering** | None. Directive takes effect on the next naturally-emitted sheet. | Immediate. `sendUserMessage` fires right after persistence. |
| **Busy / session state** | Not relevant (no message sent). | Idle → direct send; busy → `deliverAs: "followUp"`. |
| **Persistence** | `pi.appendEntry(USER_PIN_CUSTOM_TYPE, …)` | Identical |
| **`forceNextAppend`** | Armed | Armed (same) |
| **Display** | Combined workpad via `ctx.ui.notify` | Identical |
| **Agent tool schema** | Unchanged | Unchanged |

## Acceptance criteria

1. `/mini-self-org-user-pin-submit <text>` pins AND submits in one command.
2. After execution: `userDirective` set, `forceNextAppend` armed, a real user message in the transcript, and an agent turn started.
3. On the next `turn_end` sheet, the directive appears in the `[User directive]` / standing-guardrail block.
4. **Turn-1 framing (PENDING):** on the submitted turn, the LLM context includes the directive framed as the standing guardrail (via the `before_agent_start` transient bridge), and the bridge is **not** re-injected on the next turn — including under `never`-injection-policy, where no sheet is ever appended.
5. If the agent is streaming: pin is set and the submit is queued via `deliverAs: "followUp"` (no unhandled exception).
6. If no model/auth: pin is set and the error is handled (no unhandled exception surfaces).
7. Validation errors (empty, >300) occur **before** any pin entry is written.
8. No-argument + `hasUI` opens the interactive prompt; no-argument + `!hasUI` notifies a usage error.
9. Existing pin/unpin/display/history commands are unaffected (regression).

## Documentation

Update `README.md` command table with the new command and its active/passive semantics.
