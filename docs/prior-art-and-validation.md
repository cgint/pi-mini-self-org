# Prior art and validation

## Current conclusion

**Retain the bounded, session-/branch-local mini-self-org workpad. Do not turn it into project memory or a task tracker.** It is an agent-owned snapshot with `overallGoal`, `currentFocus`, `nextActions`, `blockers`, and `notes`. `overallGoal` is the stable umbrella outcome for a session-local work thread; `currentFocus` is its immediate bounded activity. State is persisted in Pi session tool-result `details.snapshot`; it is neither an unpersisted scratch buffer nor an external/shadow store.

The registered current tool is `mini-self-org-workpad`. Reconstruction reads both current results and legacy `workpad` results, but the legacy alias is not registered and new snapshots are written only by the current tool. The full state is rendered for the human from `details.snapshot`; one concise canonical block is injected request-locally for the model. Neither is project memory, durable cross-session task tracking, a dependency DAG, or a multi-agent coordinator.

Verified implementation evidence is in the repository's `src/mini-self-org.ts` (snapshot shape, `toolResult.details.snapshot`, recovery, renderer, and context hook) and `README.md` (scope, renderer, and storage contract).

## Comparable prior art

| Comparable | Verified source | Relationship to this workpad |
| --- | --- | --- |
| Official Pi `todo.ts` | [source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/todo.ts) | Branch-aware reconstruction from tool-result details and a human `/todos` view. Its incremental todo semantics are outside this extension's scope. |
| `@99percentpeople/pi-todo` | [README](https://github.com/99percentpeople/pi-extensions/blob/master/extensions/todo/README.md) | Atomic complete-plan replacement, revision checking, dependencies, compaction/reminders, and a read-only widget: a broader task system. This is not a recommendation to adopt it. |
| `session-notes` | [repository](https://github.com/thegalexc/pi-extensions-oss) | Human-facing, zero-token session-notes panel/timeline with branch-aware append-entry reconstruction and no model handover. Complementary human visibility, not this agent context mechanism. |
| Session-goal extensions | Public Pi extension examples and patterns | Session goal with prompt injection, budgets, and continuation behavior; broader than this workpad. |
| File-backed todo extensions | Public Pi extension examples and patterns | Durable project todos with locks and assignments: a different multi-session problem. |

## Observed validation evidence

### One-session observation — bounded claim

A local, non-distributed session observation informed the working hypothesis. No session capture is included in this repository.

The observed rhythm was an initial snapshot, updates after evidence batches, then a final clear when no next action remained. Current behavior separates the compact model-visible result from the full human renderer and the one request-local model handover. This is one-session observation, not proof of general agent behavior.

### Verified source/test evidence

A non-empty update persists `details.snapshot`, returns compact model-visible content, visibly renders the normalized snapshot, and injects one canonical request-local block. Clearing reports and renders that no context will be injected. Recovery recognizes both `workpad` and `mini-self-org-workpad`. Evidence is in `src/mini-self-org.ts` and `test/mini-self-org.test.ts`.

### Dated local quality check

The required `npm run precommit` check is the local quality gate: TypeScript, Vitest, and the moderate audit check. Its result is recorded in the worker report for this change.

## Decisions and non-decisions

- Keep this extension; do not switch to the compared candidates.
- Keep the five core fields and scope bounded; do not add criteria, constraints, or task-tracker operations without usage evidence.
- The current tool name is `mini-self-org-workpad`; retain legacy `workpad` recovery only.
- Full renderer output and request-local injected context have distinct audiences and must not duplicate a second model handover.
- A widget is a future optional experiment if slash inspection is insufficient; it is not current scope.
- Force mode remains default-off pending real runtime gate evidence. Core-workpad validation does not depend on force mode.

## Explicit verification backlog

These are unresolved runtime tests, not confirmed defects:

1. **Visible output:** update, then inspect the renderer output after the current change.
2. **Recovery:** update, reload or switch via `/tree`, then inspect the restored snapshot and next-request injection.
3. **Force mode:** test initial due → current workpad alone → later action allowed → action result makes workpad due → multi-tool sibling action remains blocked. The gate has a text-only limitation: Pi's supported extension API cannot mechanically block text-only responses.
4. **Long-session scaling:** before changing output, measure tool-result/context token cost and usability. Do not label this a correctness defect: final request-local injection means older snapshots do not become the authoritative final handover.
