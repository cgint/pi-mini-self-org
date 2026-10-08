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

## Sources
- Exploration: completed design discussion (2026-10-19).
- Design: `docs/design-user-pinned-directive.md` §4 (Passive vs. Active).
- Feasibility: confirmed `pi.sendUserMessage` supports both `expandPromptTemplates: false` (idle) and `deliverAs: "followUp"` (busy).
