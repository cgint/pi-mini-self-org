# Spec: hard-delete transient injection; unify on persistent `turn_end` append

Date: 2026-10-19 · Status: **SPEC — secondmate reviewed (w2C:p2), 5 fixes adopted, ready for implementation**

> **Post-implementation note (empty-workpad nudge extension):** the §5 code block is
> partially superseded — scheduled mode now ticks `turnsSinceLastAppend` on EVERY
> completed turn (including empty-workpad turns) and appends a nudge sheet at the
> boundary when the pad is empty. The §5 prose note ("Empty-snapshot turns still
> advance `turnsSinceLastAppend` … This is deliberate") was the intended behavior and
> is now implemented; the §5 code block was the defect. `user-boundary` mode still
> appends only when the pad has content. Also: in scheduled mode a forced append
> with an empty pad is consumed by the nudge (the nudge serves the re-anchor role),
> so the §5 "force survives until it can produce a sheet" note (Bug B) applies to
> `user-boundary` mode only.

> **Secondmate review (w2C:p2, 2026-10-19):** Verdict: solid spec, one internal
> contradiction, one migration landmine, two text-staleness bugs. Approved after
> five fixes, all adopted below: (a) §5/§11 contradiction resolved via unified
> `forceNextAppend`, (b) unconditional `sessionTurnCount` increment at handler entry,
> (c) `history-scheduled:N` aliased to `{mode:"scheduled", interval:N}` rather than
> thrown (lossless rename, avoids breaking working setups on upgrade), (d) two text
> fixes (`historySheetBody` stale tool name, `RECALL_GUIDANCE` transient-tail
> wording), (e) four test additions (force in user-boundary, aborted-turn boundary,
> reconstruction counter, history-scheduled mapping). `always` → warn + `never`
> fallback (not hard throw). See §13 for the full changelog.

## 1. What changes

The `context`-hook transient injection path is **fully deleted**. The `turn_end`
persistent append becomes the **sole** injection mechanism. The env var
`MINI_SELF_ORG_INJECTION` keeps its name but its accepted values change:

| Value | Behavior (post-change) |
|---|---|
| *(unset/empty)*, `never`, `off` | No injection. Tool-only access. |
| `user-boundary` | Persistent: append on the first completed turn after each user-submitted agent loop. |
| `user-boundary+scheduled:<N>` | **Composite** (order-insensitive; `history-scheduled:<N>` accepted as the scheduled token too): enables **both** triggers. A sheet is appended on the first completed turn after each user loop **or** every `N` completed turns (or when forced), whichever fires first; a boundary-only sheet never resets the scheduled cadence. |
| `scheduled:<N>` | Persistent: append a sheet every `N` completed `turn_end` events. |
| `history-scheduled:<N>` | **Aliased** to `scheduled:<N>` (lossless rename — same mechanism, new name). No warning. |

**Rejected at init (hard throw):** composites mixing `never`/`off`/`always` with anything, duplicate triggers (`user-boundary+user-boundary`, `scheduled:2+scheduled:3`), missing tokens (`user-boundary+`, `+scheduled:2`, `+`), malformed intervals (`scheduled:0`, `scheduled:1.5`, `scheduled:`), whitespace, and unknown tokens. Standalone `always` remains the one fail-soft case: it **warns** and falls back to `never` (not a hard throw — a hard throw kills the entire extension including tools on upgrade; fail-soft preserves tool access); composites containing `always` **throw** because the intent is ambiguous.

## 2. What is deleted (code)

From `src/mini-self-org.ts`:

- `contextMessage()` function (transient sheet body formatter)
- `forceNextInjection` variable
- `callsSinceLastInjectionOrWrite` variable
- The `context` hook's **append block** (the `if (shouldInject) { messages.push(…) }` path)
- `parseInjectionPolicy`: the `always` branch, the `history-scheduled:` regex branch,
  and the `"history"` mode label. The `scheduled:` regex now returns
  `{ mode: "scheduled", interval }` where `"scheduled"` is the **persistent** mode
  (previously `"history"`).
- The `before_agent_start` hook's role changes: it still fires, but now it arms
  a `pendingUserBoundary` flag that is consumed by `turn_end` (not by `context`).

## 3. What is kept / renamed

- `turn_end` handler — the sole injection mechanism. Gated on:
  - `event.outcome === "completed"` (Q2)
  - at least one persistent trigger enabled (`userBoundary` or `scheduledInterval` set)
  - scheduled trigger due: `turnsSinceLastAppend >= scheduledInterval` (or `forceNextAppend`)
  - boundary trigger due: `pendingUserBoundary` is armed
  - coalescing: at most one sheet per turn; a boundary-only sheet never resets the scheduled cadence
- `turnsSinceLastAppend`, `forceNextAppend`, `sessionTurnCount` — kept; `sessionTurnCount` initializes from persisted sheet count for **any** enabled persistent policy (fixes the atomic `user-boundary` marker gap)
- `pendingUserBoundary` — kept, but now consumed by `turn_end` not `context`
- `reconstructLastPersisted` / `reconstructSnapshot` / `reconstructHistory` — kept
- `context` hook — **strip-only** (removes stale `WORKPAD_CUSTOM_TYPE` custom messages
  from `event.messages`). No injection path.
- All three tools (`self-org-workpad-set`, `self-org-workpad-get`,
  `self-org-workpad-history`) — kept
- Both commands (`/mini-self-org`, `/mini-self-org-history`) — kept
- `session_compact` → `forceNextAppend = true` — kept (applies to both persistent modes)

## 4. Internal representation

The exclusive `InjectionPolicy` union is replaced by a normalized capability object:

```ts
interface InjectionPolicy {
  userBoundary: boolean;
  scheduledInterval?: number;
}
```

Disabled injection is `{ userBoundary: false }`. The parser runs once at extension initialization; runtime handlers read this normalized object and never re-parse env text, and no runtime branch accommodates invalid config (invalid values are rejected at parse time). `history-scheduled:N` remains a silent alias of `scheduled:N`, usable both atomically and inside the composite `user-boundary+scheduled:N` (order-insensitive; `+` is the sole composite delimiter).

## 5. `turn_end` handler (post-change)

```ts
pi.on("turn_end", (event) => {
  if (event.outcome !== "completed") return undefined;
  if (!injectionPolicy.userBoundary && injectionPolicy.scheduledInterval === undefined) return undefined;
  // Q3 marker: increment whenever any persistent trigger is enabled, so every sheet
  // carries a turn index regardless of the enabled combination.
  sessionTurnCount += 1;
  if (injectionPolicy.scheduledInterval !== undefined) turnsSinceLastAppend += 1;
  const boundaryDue = injectionPolicy.userBoundary && pendingUserBoundary;
  const forceAppend = forceNextAppend;
  const scheduledDue =
    injectionPolicy.scheduledInterval !== undefined &&
    (turnsSinceLastAppend >= injectionPolicy.scheduledInterval || forceAppend);
  // Coalesce at most one sheet per turn; a boundary-only sheet never resets the
  // scheduled cadence, so composition keeps both triggers' standalone meaning.
  if (hasContent(snapshot) && (boundaryDue || scheduledDue || forceAppend)) {
    pendingUserBoundary = false;
    forceNextAppend = false;
    if (scheduledDue) turnsSinceLastAppend = 0;
    return { /* one state sheet */ };
  }
  // Empty pad: a due scheduled window or force consumes a nudge sheet; a
  // boundary-only due keeps the boundary (and force) pending.
  if (scheduledDue) {
    forceNextAppend = false;
    turnsSinceLastAppend = 0;
    return { /* one empty-workpad nudge sheet */ };
  }
  return undefined;
});
```

Notes:
- `sessionTurnCount` is incremented for **any** enabled persistent policy (composite-aware), not per-branch. This ensures every sheet — scheduled, user-boundary, or composite — carries a turn index (secondmate D1). The marker is diagnostic only, not semantic.
- `hasContent` is checked **before** force read/clear (secondmate Bug B). If the workpad is empty, the force survives until a sheet can actually be produced.
- `boundaryDue` requires the boundary to be armed (`pendingUserBoundary`); `scheduledDue` requires `scheduledInterval` set and either the counter threshold or `forceNextAppend`. A boundary-only sheet never resets the scheduled cadence; a scheduled or forced sheet does.
- Empty-snapshot turns still advance `turnsSinceLastAppend` when scheduling is enabled, so a later-populated workpad appends immediately once ≥ N. This is deliberate: "frequency governs when, content governs whether" (secondmate confirmation).
- A nudge (empty-pad scheduled/force emission) does NOT clear `pendingUserBoundary`, so a boundary can be deferred past an empty-pad turn.

## 6. `before_agent_start` (post-change)

```ts
pi.on("before_agent_start", async () => {
  if (injectionPolicy.userBoundary) {
    pendingUserBoundary = true;
  }
});
```

Arms the flag whenever the `userBoundary` capability is enabled (atomic or composite). No-op when scheduling-only.

## 7. `context` hook (post-change)

```ts
pi.on("context", async (event) => {
  return {
    messages: event.messages.filter(
      (message) => message.role !== "custom" || message.customType !== WORKPAD_CUSTOM_TYPE,
    ),
  };
});
```

Strip-only. No injection. No flags read or written.

## 8. `session_start` / `session_tree` / `session_compact` (post-change)

```ts
const reconstruct = (ctx: ExtensionContext) => {
  snapshot = reconstructSnapshot(ctx);
  if (injectionPolicy.scheduledInterval !== undefined) {
    turnsSinceLastAppend = 0;
  }
  if (injectionPolicy.userBoundary || injectionPolicy.scheduledInterval !== undefined) {
    // Q3 marker: continue from persisted sheet count for any enabled persistent policy.
    sessionTurnCount = ctx.sessionManager.getBranch().filter((entry) => {
      const item = entry as { type?: string; customType?: string } | undefined;
      return item?.type === "custom_message" && item.customType === WORKPAD_CUSTOM_TYPE;
    }).length;
    forceNextAppend = true;
  }
};
pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));
pi.on("session_compact", async () => {
  forceNextAppend = true;
});
```

`session_compact` sets `forceNextAppend` unconditionally. `reconstruct` resets the scheduled window when scheduling is enabled and initializes `sessionTurnCount` + sets `forceNextAppend` for **any** enabled persistent policy, atomic or composite (D3: resume/branch-switch is a boundary crossing).

## 9. Test changes

- **T1 (policy parsing):** update the accepted/rejected lists. Accepted: `undefined`, `""`, `never`, `off`, `scheduled:2`, `scheduled:4`, `user-boundary`, `history-scheduled:8` (aliased to scheduled, not rejected), and the composites `user-boundary+scheduled:3` / `scheduled:3+user-boundary` (plus their `history-scheduled` spellings, order-insensitive). Rejected: `always` (warn + never fallback, not hard throw), `Always`, ` user-boundary`, `scheduled:0`, `scheduled:-1`, `scheduled:1.5`, `scheduled:01`, `scheduled:9007199254740992`, `other`, and all invalid composites: `never+user-boundary`, `off+scheduled:2`, `always+user-boundary`, `user-boundary+user-boundary`, `scheduled:2+scheduled:3`, `scheduled:2+history-scheduled:3`, `user-boundary+`, `+scheduled:2`, `+`, `user-boundary +scheduled:2`, `user-boundary+scheduled: `, `foo+user-boundary`, `user-boundary+scheduled:`. All composites must normalize identically: `{ userBoundary: true, scheduledInterval: N }`.
- **T2–T10 (history-scheduled tests):** rename the mode from `"history"` to
  `"scheduled"` in all assertions. The `setupWithInjection("history-scheduled:3")`
  calls become `setupWithInjection("scheduled:3")`.
- **New test:** `user-boundary` persistent mode — `before_agent_start` arms the flag;
  first completed `turn_end` appends a sheet; second completed `turn_end` (same user
  loop) does not append; next `before_agent_start` re-arms; next `turn_end` appends.
- **New test (secondmate):** force in `user-boundary` mode — compaction → next
  completed `turn_end` appends without a prior `before_agent_start`; the one after
  doesn't (T8 currently scheduled-only; extend to user-boundary).
- **New test (secondmate):** aborted turn doesn't consume the boundary —
  `before_agent_start` → aborted `turn_end` (outcome ≠ completed) → completed
  `turn_end` still appends.
- **New test (secondmate):** reconstruction counter — branch with k sheets →
  `sessionTurnCount` continues at k (pins the step-7 fix; spec §8 has the logic
  but no test named it).
- **New test (secondmate):** `history-scheduled:N` mapping — `setupWithInjection
  ("history-scheduled:4")` produces `{mode: "scheduled", interval: 4}` (aliased,
  not rejected). Update T1's accepted list accordingly.
- **T5 (context hook strip-only):** update to verify the context hook strips
  `WORKPAD_CUSTOM_TYPE` custom messages and does NOT inject (no `messages.push`).
  This test should pass in all modes (the strip is unconditional).
- **Update `setupWithInjection` default:** if the test helper's default was
  `history-scheduled`, update it to `scheduled`.

## 10. README changes

- Update the injection policy section: remove `always` and `history-scheduled:<N>`
  from the accepted values. Update `scheduled:<N>` description to say "persistent:
  append a sheet every N completed turns." Update `user-boundary` description to say
  "persistent: append on the first completed turn after each user-submitted agent
  loop."
- Remove the `history-scheduled:1` warning (value no longer exists).
- Update the "transient" language: the context hook is now strip-only; injection
  happens at `turn_end`.

## 11. Resolved decisions (secondmate, w2C:p2, 2026-10-19)

1. **`sessionTurnCount` in `user-boundary` mode:** **YES** — increment
   unconditionally at handler entry (after outcome check), not per-branch.
   Rationale: the Q3 marker's purpose is reliable sheet identification; mixed-mode
   or post-switch sessions would have marker-less entries interleaved with marked
   ones if user-boundary sheets carried no marker. Cost is nil.

2. **`forceNextAppend` in `user-boundary` mode:** **YES** — the `user-boundary`
   branch gates on `pendingUserBoundary || forceNextAppend` and clears both on
   consumption. This resolves the §5/§11 contradiction (secondmate D2). The
   unified flag means compaction, session start, and branch switch all bypass the
   user-boundary gate on the next completed turn.

3. **`reconstruct` in `user-boundary` mode:** **YES** — set `forceNextAppend = true`
   in `reconstruct` for both persistent modes. A resume/branch-switch is a boundary
   crossing (main's legacy behavior agreed — old code set `forceNextInjection = true`
   in `reconstruct`). This reproduces legacy semantics: fresh session +
   user-boundary → first completed turn appends, same as the old first-call
   injection. `before_agent_start` arming remains idempotent.

4. **`history-scheduled:N` migration:** **Alias** to `{mode: "scheduled", interval: N}`
   silently (lossless rename — same mechanism, new name). No warning. This avoids
   the migration landmine: users who set `history-scheduled:N` in their env get the
   same behavior under the new name, not a hard throw that kills the extension.

5. **`always` migration:** **Warning + fallback to `never`** (not a hard throw).
   A hard throw on a previously-valid value breaks the entire extension (tools
   gone) on upgrade — a different contract than fail-fast on malformed values.
   The warning names the migration path: use `scheduled:1` for per-turn or
   `scheduled:N` for per-N-turns. Composite values containing `always` (e.g.
   `always+user-boundary`) are NOT fail-soft — they throw, because the intent is
   ambiguous ("always" has no defined composite semantics).

6. **Composite coalescing (single sheet per turn):** when boundary and scheduled
   are both due on the same completed turn, emit exactly ONE state sheet and
   reset the scheduled counter. A boundary-only sheet (boundary due, scheduled not
   due) does NOT reset `turnsSinceLastAppend`, so the scheduled cadence retains its
   standalone meaning — frequent user boundaries cannot starve the scheduled
   trigger. An empty-pad nudge (scheduled/force due) clears force and resets the
   counter but leaves `pendingUserBoundary` set, so a boundary can be deferred
   until the pad is non-empty.

## 12. Commit plan

Single commit (or small series):
1. `refactor: hard-delete transient injection; unify on persistent turn_end append`
   - src changes (§2–§8)
   - test changes (§9 + four secondmate additions)
2. `docs: update README + design doc + roadmap for post-transient-deletion policy`
   - README changes (§10)
   - Status note in `design-history-appending-mode.md` recording the full-replacement
     end-state executed as `scheduled:N` (mode label renamed)
   - Status note in `roadmap-cache-and-perception.md` recording the decision

Both commits on `main`, pushed to `origin/main`.

## 13. Secondmate review changelog (w2C:p2, 2026-10-19)

| # | Issue | Resolution |
|---|-------|------------|
| D1 | `sessionTurnCount` in user-boundary | Increment unconditionally at handler entry (§5 updated) |
| D2 | `forceNextAppend` unreachable in user-boundary (§5/§11 contradiction) | Unified: user-boundary gates on `pendingUserBoundary \|\| forceNextAppend`, clears both (§5 updated) |
| D3 | `reconstruct` on resume | Set `forceNextAppend = true` in reconstruct for both persistent modes (§8 updated) |
| Bug B | Force consumed before `hasContent` check | Move `hasContent` before force read/clear (§5 updated) |
| Migration | `history-scheduled:N` hard throw breaks working setups | Alias to `{mode:"scheduled", interval:N}` silently (§1 updated) |
| Migration | `always` hard throw kills extension on upgrade | Warning + fallback to `never` (§1 updated) |
| Text | `historySheetBody` stale tool name (`mini-self-org-workpad`) | Update to `self-org-workpad-set` (implementation task) |
| Text | `RECALL_GUIDANCE` describes deleted transient tail | Reword for persistent mid-history sheets (implementation task) |
| Test | Force in user-boundary mode (T8 scheduled-only) | Add test: compaction → next completed turn_end appends without prior before_agent_start (§9 added) |
| Test | Aborted turn doesn't consume boundary | Add test: before_agent_start → aborted turn_end → completed turn_end still appends (§9 added) |
| Test | Reconstruction counter | Add test: branch with k sheets → sessionTurnCount continues at k (§9 added) |
| Test | `history-scheduled:N` mapping | Update T1: `history-scheduled:N` is accepted (aliased), not rejected (§9 updated) |
| Docs | Beyond README | Add status notes to design doc + roadmap (§12 updated) |
| Limitation | Post-compaction marker regression (counter can go backwards) | Record as known limitation; marker is diagnostic only, not semantic |
