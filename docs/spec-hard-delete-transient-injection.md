# Spec: hard-delete transient injection; unify on persistent `turn_end` append

Date: 2026-10-19 · Status: **SPEC — secondmate reviewed (w2C:p2), 5 fixes adopted, ready for implementation**

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
| `scheduled:N` | Persistent: append a `custom_message` sheet every N completed `turn_end` events. |
| `user-boundary` | Persistent: append on the first completed turn after each user-submitted agent loop. |
| `history-scheduled:N` | **Aliased** to `scheduled:N` (lossless rename — same mechanism, new name). No warning. |

**Rejected at init:**
- `always` — no persistent equivalent (per-call ≠ per-turn). **Warning + fallback to `never`** (not a hard throw — a hard throw kills the entire extension including tools on upgrade; fail-soft preserves tool access). The warning names the migration path: use `scheduled:1` for per-turn or `scheduled:N` for per-N-turns.
- Any other non-empty value → hard throw (`MINI_SELF_ORG_INJECTION must be …`).

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
  - mode is `"scheduled"` or `"user-boundary"` (the two persistent modes)
  - for `"scheduled"`: `turnsSinceLastAppend >= interval` (or `forceNextAppend`)
  - for `"user-boundary"`: `pendingUserBoundary` is armed
  - `hasContent(snapshot)`
- `turnsSinceLastAppend`, `forceNextAppend`, `sessionTurnCount` — kept
- `pendingUserBoundary` — kept, but now consumed by `turn_end` not `context`
- `reconstructLastPersisted` / `reconstructSnapshot` / `reconstructHistory` — kept
- `context` hook — **strip-only** (removes stale `WORKPAD_CUSTOM_TYPE` custom messages
  from `event.messages`). No injection path.
- All three tools (`self-org-workpad-set`, `self-org-workpad-get`,
  `self-org-workpad-history`) — kept
- Both commands (`/mini-self-org`, `/mini-self-org-history`) — kept
- `session_compact` → `forceNextAppend = true` — kept (applies to both persistent modes)

## 4. Internal mode label change

The internal mode label for the persistent append changes from `"history"` to
`"scheduled"`. Rationale: `history-scheduled:N` is removed from the public env var
grammar; `scheduled:N` is now the only persistent-cadence value. The label
`"scheduled"` is shorter and matches the env var value. The `user-boundary` mode
keeps its label `"user-boundary"`.

The `InjectionPolicy` type becomes:

```ts
type InjectionPolicy =
  | { mode: "never" }
  | { mode: "user-boundary" }
  | { mode: "scheduled"; interval: number };
```

## 5. `turn_end` handler (post-change)

```ts
pi.on("turn_end", (event) => {
  if (event.outcome !== "completed") return undefined;
  if (injectionPolicy.mode === "never") return undefined;
  // Q3 marker: increment unconditionally (all persistent modes), so every sheet
  // carries a turn index regardless of mode. Cost: nil.
  sessionTurnCount += 1;
  if (!hasContent(snapshot)) return undefined;
  // "Force survives until it can produce a sheet": hasContent check BEFORE force
  // read/clear, so an empty workpad at compaction time does not lose the force.

  if (injectionPolicy.mode === "user-boundary") {
    if (!pendingUserBoundary && !forceNextAppend) return undefined;
    pendingUserBoundary = false;
    forceNextAppend = false;
  } else {
    // mode === "scheduled"
    turnsSinceLastAppend += 1;
    const forceAppend = forceNextAppend;
    forceNextAppend = false;
    if (!forceAppend && turnsSinceLastAppend < injectionPolicy.interval) return undefined;
    turnsSinceLastAppend = 0;
  }

  return {
    entries: [{
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: historySheetBody(snapshot, sessionTurnCount),
      display: false,
      details: { snapshot: { ...snapshot, nextActions: [...snapshot.nextActions], blockers: [...snapshot.blockers], notes: [...snapshot.notes] } },
    }],
  };
});
```

Notes:
- `sessionTurnCount` is incremented **unconditionally** at handler entry (after the
  outcome check), not per-branch. This ensures every sheet — scheduled or
  user-boundary — carries a turn index (secondmate D1). The marker is diagnostic
  only, not semantic.
- `hasContent` is checked **before** force read/clear (secondmate Bug B). If the
  workpad is empty, the force survives until a sheet can actually be produced.
- In `user-boundary` mode, the gate is `pendingUserBoundary || forceNextAppend`
  (secondmate D2/D3). Both flags are cleared on consumption. This unifies recovery
  semantics: compaction, session start, and branch switch all set `forceNextAppend`,
  which bypasses the user-boundary gate on the next completed turn.
- Empty-snapshot turns still advance `turnsSinceLastAppend` (scheduled mode), so a
  later-populated workpad appends immediately once ≥ N. This is deliberate:
  "frequency governs when, content governs whether" (secondmate confirmation).

## 6. `before_agent_start` (post-change)

```ts
pi.on("before_agent_start", async () => {
  if (injectionPolicy.mode === "user-boundary") {
    pendingUserBoundary = true;
  }
});
```

Only arms the flag in `user-boundary` mode. No-op in `scheduled` and `never` modes.

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
  if (injectionPolicy.mode === "scheduled") {
    turnsSinceLastAppend = 0;
    sessionTurnCount = ctx.sessionManager.getBranch().filter((entry) => {
      const item = entry as { type?: string; customType?: string } | undefined;
      return item?.type === "custom_message" && item.customType === WORKPAD_CUSTOM_TYPE;
    }).length;
  }
  // D3: a resume/branch-switch is a boundary crossing. Set forceNextAppend so the
  // first completed turn after resume appends a sheet (both persistent modes).
  // Reproduces legacy semantics (old code set forceNextInjection=true in reconstruct).
  if (injectionPolicy.mode === "scheduled" || injectionPolicy.mode === "user-boundary") {
    forceNextAppend = true;
  }
};
pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));
pi.on("session_compact", async () => {
  forceNextAppend = true;
});
```

`session_compact` sets `forceNextAppend` unconditionally. `reconstruct` initializes
the turn counter in `scheduled` mode and sets `forceNextAppend` for both persistent
modes (D3: resume/branch-switch is a boundary crossing).

## 9. Test changes

- **T1 (policy parsing):** update the accepted/rejected lists. Accepted:
  `undefined`, `""`, `never`, `off`, `scheduled:2`, `scheduled:4`, `user-boundary`,
  `history-scheduled:8` (aliased to scheduled, not rejected). Rejected:
  `always` (warn + never fallback, not hard throw), `Always`, ` user-boundary`,
  `scheduled:0`, `scheduled:-1`, `scheduled:1.5`, `scheduled:01`,
  `scheduled:9007199254740992`, `other`.
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
   `scheduled:N` for per-N-turns.

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
