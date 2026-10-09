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

## The turn-1 guardrail-framing gap (open design concern)

"Submitting the text as the user message" delivers the *text*, but **not** the
*standing-invariant status*. The pinned-as-supreme-guardrail state only enters
the LLM context at the `turn_end`-emitted sheet — *after* the agent already
replied to the submitted text. So on turn 1 the LLM sees the raw text as an
ordinary user request, **not** framed as the supreme invariant. The invariant
framing takes effect from turn 2 onward.

**This is the part of the feature that is *not* yet implemented.** The
currently-shipped `pin-submit` closes the "submit now" half (the text reaches
the LLM on turn 1) but leaves the "it is a standing guardrail *from turn 1*"
half blind. Closing it requires a turn-1 transient-directive bridge: inject the
directive's supreme-invariant framing into the LLM context of the submitted
turn, then disarm on the next turn boundary. See `3_plan__user-pin-submit.md`
(Pending section) for the constraints (turn-boundary disarm, `never`-policy
regression, shared invariant text, distinct customType).

## SDK facts (verified in `agent-session.js` / `types.d.ts`)

| Fact | Evidence |
|---|---|
| `sendUserMessage` → `prompt()` with `source: "extension"` | `agent-session.js:1812` |
| Streaming + no `deliverAs` → **throws** | `agent-session.js:1522` |
| `before_agent_start` returned message is non-persisted (in-memory only) | `agent-session.js:1583-1594` |
| `_throwIfExtensionCommand` guard only in `_queueUserInput`, not `prompt()` | `agent-session.js:1656` |
| focus-guard `--dm-read` does not block user messages | verified |

## Implementation status

- ✅ **Implemented:** pin + submit, idle → direct send / busy → `followUp`, validation (trim / empty / ≤300), interactive `ui.input` fallback, `forceNextAppend` arming.
- ❌ **Pending:** turn-1 guardrail-framing bridge (`before_agent_start` transient injection + turn-boundary disarm).

## Out of scope

- Modifying existing `/mini-self-org-user-pin` behavior.
- A new persistent customType for the pin (reuses `USER_PIN_CUSTOM_TYPE`; the pending turn-1 bridge uses a *separate, non-persisted* customType).
