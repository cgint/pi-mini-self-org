# Project Overview — pi-mini-self-org

*Last updated: 2026-07-17*

## Current State

The extension is **functionally complete** for its core scope:
- Three tools registered: `self-org-workpad-set`, `self-org-workpad-get`, `self-org-workpad-history`
- Injection architecture: persistent `turn_end` append only (transient path hard-deleted)
- Env var `MINI_SELF_ORG_INJECTION`: `never` (default), `user-boundary`, `scheduled:<N>`, `history-scheduled:<N>` (alias), composite `user-boundary+scheduled:<N>`
- User-pinned directives: `/mini-self-org-user-pin` / `/mini-self-org-user-unpin`
- Focus history: `/mini-self-org-history` command + tool
- **TUI-only compass notice** (uncommitted): a one-line `ctx.ui.notify` shows the
  human when the steering sheet is injected to the agent — `↻ compass updated`
  on a content change, `✓ compass cleared` on content→empty. Content-gated (not
  every tick), quiet on reload, agent-invisible (the sheet stays `display:false`).
  See `docs/feature-impl/20260717-compass-notice/`.
- Comprehensive test suite (~1700 lines, 106 tests)

## Active WIP (uncommitted)

**User-Pin Visual Emphasis & Semantic Clarity** — in-flight changes:
- `src/mini-self-org.ts`: New `USER_GUARDRAIL_DELIMITER` (`─`×60) and
  `INJECTION_GUARDRAIL_DELIMITER` (`═`×60); `formatWorkpad` and
  `historySheetBody` now render the directive with explicit visual borders,
  "supreme invariant" operational rule, and silent-adherence instruction.
- `test/mini-self-org.test.ts`: Updated assertions + 5 new acceptance tests
  (REQ-1/AC-1, REQ-2, REQ-2/AC-4, REQ-3/AC-2, AC-3).
- `docs/cache-test-matrix.md`: Updated.
- `docs/feature-impl/README.md`: Feature-impl directory convention established.
- `docs/requirements-user-pin-emphasis-and-semantics.md`: Requirements doc (draft).
- **Status:** Reviewed by Gemini sub-agent (2026-10-07) — no defects found.
  Ready for commit or further refinement.

## Next Actions

1. **Commit** the user-pin emphasis WIP (diff is reviewed and clean).
2. Consider moving the WIP docs into `docs/feature-impl/20261007-user-pin-emphasis/`
   per the new convention.
3. **Cache validation:** Run cache-test-matrix experiments on Gemini 3.7/3.8
   and a weaker model to validate `scheduled:N` retention.
4. **Weak-model retention:** Measure whether the injection cadence preserves
   steering on lower-capability models (open research question).
5. **Release:** Bump version, update README if any behavior changed since last publish.

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
