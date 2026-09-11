# Plan: Reframe workpad prompt surface — own scratchpad, durable-only content

Date: 2026-09-11
Status: Implemented (A–E + test contract + README); precommit green; interactive runtime check pending
Result (2026-09-11): `src/mini-self-org.ts` rewritten per A–E; only the
injected-block exact-content test assertion changed (L58–65 substrings
intentionally preserved); `npm run precommit` passed (typecheck, 20/20 tests,
0 vulnerabilities); README framing updated to match. Remaining: step 4
interactive check and step 6 evidence note below.
Scope: prompt-surface wording in `src/mini-self-org.ts` + test contract updates. No schema, storage, or mechanism changes.

## Problem

Two observed irritation mechanisms, both in model-facing text (not the mechanism):

1. **Report/auditor framing.** The workpad reads as an external obligation, not the
   agent's own scratchpad. Evidence in `src/mini-self-org.ts`:
   - Injected block (`contextMessage`) opens:
     `Session-local, non-authoritative mini-self-org workpad. Current until replaced or cleared.`
     — bureaucratic metadata; `non-authoritative` reads as "not mine to steer by."
   - Tool description is obligation/prohibition-stacked ("must never", "Do not merely
     state that it is stale", "Do not update ritualistically", "Do not use it for …").
   - The intended framing ("agent-owned snapshot") exists only in
     `docs/prior-art-and-validation.md`, never in model-facing strings.

2. **Volatile-status dumping.** Structural incentives outweigh the single prohibition
   ("Do not use it for project memory, evidence, approved plans, or task tracking"):
   - Change-detection update trigger: "Replace the complete snapshot whenever either
     field, next actions, blockers, or notes change" → mirrors fresh tool results.
   - Evidence-tag guidance ("when the evidence status matters") invites
     notes-as-evidence-ledger, contradicting "Do not use it for … evidence".
   - `notes` has no durability criterion (unlike other fields' implicit horizons);
     5×300 chars gives ample room.
   - Every-request re-injection makes volatile content permanent framing, and the
     model keeps feeding it to stay "current".

## Changes (all in `src/mini-self-org.ts`)

A. **Injected block header** (`contextMessage`):
   `Your own working scratchpad — steering state for this session, not a record.
   Re-derive facts from the conversation and tools rather than treating notes as
   ground truth.`
   Keep `non-authoritative` only in the history tool, where it is accurate.

B. **Tool description opening** — purpose/ownership first, replacing
   "Call mini-self-org-workpad proactively throughout substantive work.":
   `Your own scratchpad for organizing your work in this session — it steers your
   next moves; the human seeing it is a side effect, not the audience.`

C. **Durability filter** (applies to all fields):
   `Write only what is worth re-reading after ten more tool calls or a context
   compaction. Anything already visible in the conversation, or stale by the next
   tool call, belongs in the conversation — not here.`

D. **`notes` re-scoped**:
   `notes = durable steering context: active hypotheses, working decisions,
   constraints. Not logs, status, or findings.`
   Evidence tags become confidence labels on steering items, not an evidence ledger.

E. **Update trigger reworded** from diff-mirroring to material change:
   `Replace the snapshot when your goal, focus, plan, or blockers materially change
   — before the next consequential action batch, not after every tool result.`
   Deliberately keeps the "before the next consequential batch" anchor to avoid
   under-updating.

F. **No capacity tuning** (notes cap stays 5): the design doc forbids tuning without
   usage evidence. Fix semantics first; measure; tune only if dumps persist.

## Risks

- Under-updating after loosening the trigger → mitigated by keeping the
  "before the next consequential action batch" anchor (E).
- Losing the epistemic caution with `non-authoritative` → replaced explicitly by
  "re-derive facts from the conversation and tools" (A).

## Constraints

- `test/mini-self-org.test.ts` pins exact strings: description substrings (L58–65)
  and the injected block content (L206). Update these assertions as a deliberate
  contract change — never bend tests around wording.
- Design doc decisions retained: five fields unchanged, no new operations,
  legacy `workpad` recovery untouched.

## Implementation steps

1. Rewrite the model-facing strings in `src/mini-self-org.ts` per A–E
   (`description`, `promptGuidelines`, `contextMessage`, `STALE_STATE_GUIDANCE`,
   `EVIDENCE_TAG_GUIDANCE` as needed).
2. Update contract assertions in `test/mini-self-org.test.ts` to the new wording.
3. `npm run precommit` (typecheck + vitest + audit).
4. Interactive check: `pi -e ./index.ts` — verify injected block reads as own
   scratchpad and no volatile status accumulates over a short real session.
5. Update `README.md` framing paragraphs to match (ownership + durability filter).
6. Record result and any residual dumping behavior here; decide on F with evidence.

## Review outcome (2026-09-11, cg-task.sh diff-review)

Full review in `cg-task-result-diff-review.md`. No defects found: template
interpolation, injection contract, safety properties (exact-tool-name guidance,
epistemic caution, under-update anchor), README/description/guidelines
consistency, and pinned substrings all confirmed. One recommendation adopted:
`promptGuidelines` now has a pinned assertion for the durability filter
("Write only what is worth re-reading"); precommit green after the addition.

## Relation to 20260911_workpad-voice-and-frame_1_PLAN.md (other session)

That plan (authored in a parallel read-blocked session, verified against pi
dist code) reports a third symptom this plan did not address: **echoing** — the
block is injected as `role: "custom"` but serializes to `role: "user"` as the
newest message, so models restate it as if the human supplied it. Its fixes
partially supersede and extend this plan:
- D1: static ownership frame moved to the system prompt via
  `before_agent_start` (byte-stable; provider cache breakpoint on system block)
- D2/D2a: tail block rewritten first-person, state-only, byte-stable while the
  snapshot is unchanged; `TOOL_NAME_GUIDANCE` removed from the injected block
- D4: content discipline in the tool contract (≈ this plan's C/D/E)

This plan implemented voice + durability + trigger (overlaps D2 voice, D4).
NOT implemented from it: system-prompt frame (D1), TOOL_NAME_GUIDANCE removal
from the injected block, byte-stability test, echo-mitigation line
("never restate; act on it").

**Decision (2026-09-11, user):** this plan is closed as implemented; the echo
symptom and its fixes (D1/D2a) are owned by
`20260911_workpad-voice-and-frame_1_PLAN.md`, not merged here. Interactive
runtime check is deferred by the user. Reviewer-base note: user judges the
advisor/diff-review agreement acceptable — different agents, different
contexts.
