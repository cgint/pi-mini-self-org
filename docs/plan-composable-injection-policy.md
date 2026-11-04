# Plan: composable workpad injection triggers

Status: **proposed — planning only**

## Outcome

Allow `MINI_SELF_ORG_INJECTION` to enable both persistent checkpoint triggers:

```text
user-boundary+scheduled:N
```

A `+` composition enables each listed trigger. On a completed `turn_end`, a
checkpoint is emitted when **either** enabled trigger is due. When both are due
on the same turn, emit exactly one entry.

This plan extends the existing persistent `turn_end` mechanism only. It does
not restore transient context-hook injection, add a tool, or change workpad
storage/reconstruction from tool-result details.

## Verified current behavior

- `src/mini-self-org.ts` currently models injection as an exclusive union:
  `never`, `user-boundary`, or `scheduled` with an interval.
- `user-boundary` is armed in `before_agent_start`; a non-empty pad appends at
  the first completed turn, while an empty pad emits nothing and keeps the
  boundary pending.
- `scheduled:N` ticks on every completed turn, emits a state sheet at its
  interval, and emits an empty-workpad nudge at the interval when no state is
  available.
- Compaction, startup, and tree navigation set `forceNextAppend`; scheduled
  mode consumes it through either a state sheet or nudge, while an empty
  user-boundary pad preserves it.
- Existing tests cover the atomic modes but no composite configuration.

## Contract

### Configuration grammar

Keep all existing atomic values unchanged:

```text
never | off | user-boundary | scheduled:N | history-scheduled:N
```

Add a two-trigger composition:

```text
user-boundary+scheduled:N
scheduled:N+user-boundary
user-boundary+history-scheduled:N
history-scheduled:N+user-boundary
```

`history-scheduled:N` remains a lossless alias of `scheduled:N`. Documentation
uses the canonical spelling `user-boundary+scheduled:N`; parsing is
order-independent and normalizes to the same internal policy. The separator is
literally `+`; preserve the existing strict configuration style by rejecting
whitespace and any other separator rather than trimming or accepting a second
grammar.

Reject composite values with `never`, `off`, or `always`; duplicate triggers;
two scheduled intervals (including an alias pair); missing tokens; malformed
intervals; and unknown tokens. Do this entirely in `parseInjectionPolicy` at
extension initialization: invalid configuration fails before handler
registration, and normalized runtime policy never represents invalid or
contradictory combinations. Preserve the existing special case: standalone
`always` warns and falls back to disabled injection. Every other invalid
non-empty configuration throws the existing configuration error.

### Internal representation

Replace the exclusive mode union with independently enabled capabilities:

```ts
interface InjectionPolicy {
  userBoundary: boolean;
  scheduledInterval?: number;
}
```

Disabled injection is `{ userBoundary: false }`. The parser runs once at
extension initialization; runtime handlers read this normalized object and do
not reparse environment text.

Keep mutable per-session state separate:

```ts
pendingUserBoundary: boolean
turnsSinceLastScheduledAppend: number
forceNextAppend: boolean
sessionTurnCount: number // diagnostic marker only
```

Only enable/tick `turnsSinceLastScheduledAppend` when `scheduledInterval` is
present. `sessionTurnCount` continues to increment for every completed turn
while any persistent trigger is enabled; it is not a cadence counter.

### Completed-turn behavior

For every `turn_end` whose outcome is `completed`:

1. If no trigger is enabled, return without changing injection state.
2. Increment `sessionTurnCount`. If scheduling is enabled, increment
   `turnsSinceLastScheduledAppend`.
3. Compute independent due conditions:
   - boundary due: `userBoundary && pendingUserBoundary`;
   - scheduled due: scheduling is enabled and either its counter reached `N`
     or `forceNextAppend` is set.
4. Decide and emit at most one entry:
   - **Non-empty pad:** when boundary, scheduled, or force is due, append one
     state sheet. Clear `pendingUserBoundary` and `forceNextAppend`. Reset the
     scheduled counter **only if scheduled or force was due**.
   - **Empty pad with scheduled/force due:** append exactly one scheduled nudge.
     Clear `forceNextAppend` and reset the scheduled counter. Do not clear a
     pending user boundary.
   - **Empty pad with only boundary due:** emit nothing. Keep the boundary and
     force state intact; the scheduled counter still advances when enabled.

The counter rule is deliberate: a boundary-only state sheet does **not** reset
scheduled cadence. Composition means both configured triggers retain their
standalone meaning. A boundary sheet and scheduled sheet can therefore occur
on adjacent turns; that is not duplication unless both triggers are due on the
same turn. A simultaneous due event is coalesced into one sheet and resets the
scheduled counter.

Preserving an empty-pad boundary is existing atomic-mode behavior: if the pad
becomes non-empty on a later completed turn in the same agent loop, that turn
may emit the deferred boundary sheet. Do not invent a second boundary-scoping
model for composite mode; instead pin this behavior with a regression test.

### Lifecycle and recovery

- `before_agent_start` arms `pendingUserBoundary` whenever `userBoundary` is
  enabled, including composite mode.
- `reconstruct` restores the snapshot as today, initializes the diagnostic
  marker from all existing workpad custom messages for **any** enabled persistent
  policy, and initializes scheduled cadence to zero when scheduling is enabled.
  It does not infer an elapsed cadence window from history; current scheduled
  behavior resets that window on reload.
- Startup, tree navigation, and compaction keep the existing one-shot force
  behavior whenever either trigger is enabled. In a composite policy, force uses
  the scheduled empty-pad nudge path when scheduling is enabled.
- The `context` hook remains strip-only. No continuation is requested and no
  extra model turn is created.

## Implementation sequence

1. **Tests first:** add parser and lifecycle tests below before changing source.
2. Refactor `InjectionPolicy` and `parseInjectionPolicy` to normalize atomic
   and composite values while preserving all legacy input behavior.
3. Update lifecycle guards (`reconstruct`, `before_agent_start`, `turn_end`) to
   test capabilities rather than exclusive modes and implement the contract
   above. Keep sheet rendering and tool state untouched.
4. Update `README.md` injection-policy documentation and the current design
   documentation to define composition, canonical spelling, aliases, and
   empty-pad/force behavior.
5. Run static checks and the full test suite; perform one live Pi session check
   with a composite environment value and inspect the resulting session JSONL
   for the expected custom-message sequence.

## Required tests

### Parser and compatibility

- Atomic `never`, `off`, `user-boundary`, `scheduled:N`, and
  `history-scheduled:N` retain current injection and cadence behavior. The
  only planned atomic correction is diagnostic-marker reconstruction for
  resumed `user-boundary` sessions, which current source does not initialize.
- Both accepted composite orders normalize identically.
- Composite legacy scheduled alias normalizes identically to canonical
  `scheduled:N`.
- Duplicate, conflicting, disabled-token, malformed-token, malformed-
  interval, empty-token, and whitespace-containing composites fail
  deterministically.
- Standalone `always` retains warn-and-disable behavior; composite `always`
  is invalid rather than silently reinterpreted.

### Composite lifecycle

- A boundary-only due turn emits one state sheet and does not reset scheduled
  cadence; scheduled emission still occurs on the expected later completed
  turn.
- A scheduled-only due turn emits one state sheet at `N` and resets only its
  cadence window.
- Simultaneous boundary and scheduled due conditions emit exactly one state
  sheet, consume the boundary, clear force if present, and reset cadence.
- An empty boundary-only turn emits nothing, preserves the boundary, and still
  advances scheduled cadence; a later non-empty completed turn in that same
  agent loop emits the deferred boundary sheet.
- An empty simultaneous boundary-and-scheduled turn emits one nudge, resets
  cadence, and preserves the pending boundary until a non-empty state sheet can
  be emitted.
- An aborted or errored turn neither advances scheduling nor consumes boundary
  or force state.
- Compaction/startup/tree force behavior is tested for non-empty and empty
  composite pads; empty composite force emits a nudge and preserves any pending
  boundary.
- Reload/tree reconstruction in composite mode preserves snapshot recovery,
  resets scheduled cadence as existing scheduled mode does, and continues the
  diagnostic marker from persisted sheets; the same marker-continuity case is
  covered for resumed atomic `user-boundary` mode.
- The context hook stays strip-only under composite configuration.

## Acceptance criteria

- Existing atomic-policy injection and cadence tests retain their behavior;
  resumed `user-boundary` gains an explicit diagnostic-marker continuity test.
- Composite configurations are deterministic, validate strictly, and create no
  duplicate sheet for one completed turn.
- A scheduled trigger retains its configured cadence even when boundary-only
  sheets happen between scheduled boundaries.
- No empty user-boundary turn suppresses a future scheduled nudge or loses the
  pending boundary.
- `npm run typecheck`, `npm test`, and the project precommit gate pass.
- A live-session inspection confirms one persisted `custom_message` at each
  expected boundary and no transient context-hook injection.

## Risks and decisions recorded

- **Cadence reset semantics:** an earlier review suggested resetting the
  scheduled window after every sheet. That would make scheduled cadence a
  fallback, but it changes the literal composition requested here: frequent
  user boundaries could prevent `scheduled:N` from ever firing. This plan
  instead resets it only when scheduling/force produced the sheet.
- **Transcript growth:** composition can legitimately produce adjacent sheets.
  This is the cost of retaining both trigger contracts. If it proves excessive,
  change the requested policy semantics explicitly rather than silently
  suppressing scheduled checkpoints.
- **Runtime verification remains required:** unit tests can prove handler
  decisions but not provider projection/retention behavior in a live Pi session.
