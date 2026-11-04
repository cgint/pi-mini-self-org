# Project Overview — pi-mini-self-org

*Last updated: 2026-07-17*

## Current State

The extension is **functionally complete** for its core scope:
- Three tools registered: `self-org-workpad-set`, `self-org-workpad-get`, `self-org-workpad-history`
- Injection architecture: persistent `turn_end` append only (transient path hard-deleted)
- Env var `MINI_SELF_ORG_INJECTION`: `never` (default), `user-boundary`, `scheduled:<N>`, `history-scheduled:<N>` (alias), composite `user-boundary+scheduled:<N>`
- User-pinned directives: `/mini-self-org-user-pin` / `/mini-self-org-user-unpin`
- Focus history: `/mini-self-org-history` command + tool
- **TUI-only steering notice** (committed, `4fda753` / `061d07d` / `c79854b` / `7c81e89`): a
  one-line `ctx.ui.notify` that fires on **every** steering-sheet injection (matching the
  `user-boundary` / `scheduled:N` cadence) — a "the agent is carrying this" ticker, pin-first,
  70-char-budgeted (e.g. `pin "Be careful" · goal "Ship the MVP"`). Silent on the empty-pad nudge;
  agent-invisible (the sheet stays `display:false`). The earlier content-gated design was
  superseded by per-injection firing (`7c81e89`).
  See `docs/feature-impl/20260717-compass-notice/`.
- Comprehensive test suite (~1700 lines, 106 tests)

## Current state

Working tree is clean except the `README.md` blocker-cap correction (two → three,
matching `MAX_BLOCKERS = 3`). Both feature threads are committed:

- **User-pin visual emphasis** (committed `a5b0760`): `USER_GUARDRAIL_DELIMITER`
  (`─`×60) / `INJECTION_GUARDRAIL_DELIMITER` (`═`×60); `formatWorkpad` and
  `historySheetBody` render the directive with explicit borders, the "supreme
  invariant" operational rule, and the silent-adherence instruction. Reviewed by
  a Gemini sub-agent (2026-10-07) — no defects found.
- **TUI-only steering notice** (committed `4fda753` / `061d07d` / `c79854b` / `7c81e89`): the
  `ui.notify` one-liner now fires on **every** sheet injection (per-injection ticker, not
  content-gated); pin-first, 70-char-budgeted; silent on the empty-pad nudge. Agent-invisible;
  precommit green (106 tests). See `docs/feature-impl/20260717-compass-notice/`.

**Open:** the transient `cg-task-result-diff-review.md` (user-pin emphasis diff,
2026-10-07) remains in the repo root — decide git-ignore vs archive (it references
git-ignored `.codegiant/` paths).

## Next Actions

1. **Decide** on `cg-task-result-diff-review.md` (transient): git-ignore vs archive
   it (references git-ignored `.codegiant/` paths; review conclusion already in the
   feature doc).
2. **Cache validation:** Run cache-test-matrix experiments on Gemini 3.7/3.8
   and a weaker model to validate `scheduled:N` retention.
3. **Weak-model retention:** Measure whether the injection cadence preserves
   steering on lower-capability models (open research question).
4. **Release:** Bump version, update README if any behavior changed since last publish.

## Blockers

None currently.

## Open Questions

- Should the `docs/feature-impl/` convention be backfilled for existing
  features (hard-delete, user-pin base, injection policy)?
- Is `blockers` max of 3 (code) vs. "0–2 items typically" (principles doc)
  intentional? Code allows 3, doc says typically 0–2.
- The `cg-task-result-diff-review.md` is a one-shot review artifact — should
  it be git-ignored or archived?

## Key Files Quick Map

| What | Where |
|---|---|
| Extension source | `src/mini-self-org.ts` |
| Tests | `test/mini-self-org.test.ts` |
| Core principles | `docs/goal-focus-and-steering-principles.md` |
| Injection spec | `docs/spec-hard-delete-transient-injection.md` |
| User-pin design | `docs/design-user-pinned-directive.md` |
| User-pin emphasis WIP | `docs/requirements-user-pin-emphasis-and-semantics.md` |
| Cache experiments | `docs/cache-test-matrix.md` |
| Feature-impl convention | `docs/feature-impl/README.md` |
