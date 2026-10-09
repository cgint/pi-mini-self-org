# 1 · Idea: user-pin-submit

## One-liner
A single command that both sets the user-pinned directive **and** immediately triggers an agent turn, instead of requiring two separate actions.

## Problem Statement

Today, setting a standing guardrail and immediately having the agent act on it
requires two separate actions:

1. `/mini-self-org-user-pin <text>` — sets the immutable user directive (passive).
2. A separate user prompt — to actually trigger an agent turn that works under
   the new directive.

This is friction: the user has to type the directive, then type (or re-type) a
prompt to make the agent engage with it. The gap between "constraint set" and
"agent acting on it" is exactly where the user's intent can be diluted — they
had to re-express, in a second message, what the directive already says.

## Concept

An **active directive command** — `/mini-self-org-user-pin-submit <text>` — that:

- Sets the immutable user directive (identical persistence path to `pin`).
- Immediately triggers an agent turn by submitting the directive text as a
  user-role message via `pi.sendUserMessage`.

The directive and the triggering prompt are one atomic user action:
"adopt this constraint *and* start working on it now."

### Passive vs. Active

| | `pin` (passive) | `pin-submit` (active) |
|---|---|---|
| Intent | Standing constraint for **future** turns | Constraint that should **immediately** drive the next action |
| Turn triggering | None — takes effect on next naturally-emitted sheet | Immediate — `pi.sendUserMessage` fires right after persistence |
| Busy state | Not relevant | Idle → direct send; busy → `deliverAs: "followUp"` |

Both write the identical `mini-self-org-user-pin` session entry. They differ
only in what happens *after* persistence.

## The turn-1 status-visibility nuance (settled — not a gap)

"Submitting the text as the user message" delivers the directive's *text*
immediately (turn 1). Its *standing-invariant status* is **set in the workpad
immediately** on pin/submit; the agent *reads* it when a sheet is injected, and
the pin's `forceNextAppend` pulls that to the **next completed turn** (ahead of
any cadence tick).

So on the submitted turn the LLM has the text but not yet the sheet's
supreme-invariant framing; that framing lands one completed turn later. This is
**by design (cadence-controlled visibility), not a missing piece.** An optional
"show the status on the submitted turn itself" bridge was considered and
**deliberately not adopted** — see the Decision note below.

## SDK facts (verified in `agent-session.js` / `types.d.ts`)

| Fact | Evidence |
|---|---|
| `sendUserMessage` → `prompt()` with `source: "extension"` | `agent-session.js:1812` |
| Streaming + no `deliverAs` → **throws** | `agent-session.js:1522` |
| `before_agent_start` returned message is non-persisted (in-memory only) | `agent-session.js:1583-1594` |
| `_throwIfExtensionCommand` guard only in `_queueUserInput`, not `prompt()` | `agent-session.js:1656` |
| focus-guard `--dm-read` does not block user messages | verified |

## Implementation status

- ✅ **Implemented (feature is COMPLETE):** pin + submit, idle → direct send / busy → `followUp`, validation (trim / empty / ≤300), interactive `ui.input` fallback, `forceNextAppend` arming.
- The directive's **status is set in the workpad immediately** on pin/submit. **When the agent reads it is governed by the injection cadence** — the pin's `forceNextAppend` pulls that to the *next completed turn* (ahead of any cadence tick). That one-turn-later *visibility* is by design (cadence-controlled), **not** a gap.

> **Decision (2026-10-21):** This feature is **done**. The "turn-1 guardrail-framing bridge" was an optional refinement (show the standing-rule *status* on the submitted turn itself) that is **not** required and **not** implemented. Do not re-open it as missing feature work. The one-turn-later status visibility is acceptable and intended.

## Out of scope

- Modifying existing `/mini-self-org-user-pin` behavior.
- A new persistent customType for the pin (reuses `USER_PIN_CUSTOM_TYPE`).
- The turn-1 status-visibility bridge (settled not-adopted; see Decision above).
