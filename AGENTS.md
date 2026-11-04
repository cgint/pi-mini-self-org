# AGENTS.md — Durable Pairing Memory for pi-mini-self-org

## Purpose

This is the root pairing-memory anchor for the **pi-mini-self-org** repository:
a bounded Pi extension that gives the agent a session-local steering workpad.

Read this file first in every session. It is the compact compass; detailed
architecture and design decisions live in `docs/`.

## What This Project Is

A single-file TypeScript Pi extension (~700 LOC) that:

1. Gives the agent a **session-local workpad** (`self-org-workpad-set/get/history`)
   for steering state: `overallGoal`, `currentFocus`, `nextActions`, `blockers`, `notes`.
2. **Injects** the workpad into LLM context at turn boundaries (persistent
   `turn_end` append only; `context` hook is strip-only).
3. Supports **user-pinned guardrails** (`/mini-self-org-user-pin`) — human-owned,
   immutable constraints that ride the same injection cadence with supreme
   precedence over agent scratchpad content.
4. Provides **focus history** — a bounded, non-authoritative timeline of past
   workpad snapshots for re-orientation after compaction.

**Non-goals (hard boundary):** Not project memory, not a task tracker, not a
dependency DAG, not multi-agent coordination. Session/branch-local only.

## Repository Layout

| Path | Role |
|---|---|
| `src/mini-self-org.ts` | The entire extension (single file, ~716 lines) |
| `test/mini-self-org.test.ts` | Vitest suite (~1600 lines, comprehensive) |
| `index.ts` | Entry point re-export |
| `docs/` | Design docs, specs, roadmaps, decision maps |
| `docs/feature-impl/` | Per-feature lifecycle docs (idea → requirements → plan → evidence) |
| `PROJECT_OVERVIEW.md` | Current status, blockers, next actions (read this second) |

**Feature Documentation Structure:** All new features follow `docs/feature-impl/<YYYYMMDD>-<feature-short-name>/`. See `docs/feature-impl/README.md` for conventions.
| `.herdr-*-report.md` | Herdr sub-agent worker reports (transient, git-ignored pattern) |

## Key Design Documents (read when relevant)

- `docs/goal-focus-and-steering-principles.md` — Core intent, cognitive failure
  modes, workpad field contracts. **Read this before touching workpad semantics.**
- `docs/spec-hard-delete-transient-injection.md` — The injection architecture
  (persistent turn_end only; env var grammar; rejected values).
- `docs/design-user-pinned-directive.md` — User-pin architecture and data model.
- `docs/requirements-user-pin-emphasis-and-semantics.md` — WIP: visual emphasis
  and semantic clarity requirements for user-pin (active).
- `docs/roadmap-cache-and-perception.md` — Cache behavior, provider
  experiments, decision map (historical + current).
- `docs/plan-composable-injection-policy.md` — Composite injection policy design.
- `docs/design-history-appending-mode.md` — History append mode (scheduled cadence).
- `docs/prior-art-and-validation.md` — Comparison with alternatives; scope guard.

## Standing Stewardship Contract

Agents collaborating in this repository **steward** durable pairing memory
with authority, responsibility, and accountability — without waiting for the
user to request it.

### Definition

**Durable pairing memory** is repository-owned, filesystem-persisted knowledge
that helps future agents continue collaborating without losing intent,
decisions, terminology, constraints, or open loops.

**Stewardship** means proactively organizing, maintaining, connecting,
correcting, and pruning durable pairing memory. It does not imply permission
to bypass read-only, privacy, safety, or approval boundaries.

### What to persist and when

**Remembering is complete only after the filesystem artifact is updated.**
Chat history, acknowledgment, internal model context, or an intention to
write later do **not** count. If filesystem writes are unavailable, report
**not persisted**.

Use the **FUTURE → CONSEQUENCE → ESSENCE → HOME** selection test before
persisting:

1. **Future:** Who could use this later, in what situation?
2. **Consequence:** What decision, action, mistake, or costly rediscovery
   could it affect?
3. **Essence:** What is the smallest stable statement that preserves that value?
4. **Home:** What is the narrowest canonical artifact that owns it?

Persist when a concrete future use can be named. If no future use exists,
leave it transient. If operationally relevant but uncertain, keep it
provisional in the task/status artifact rather than promoting it to durable
instructions.

**User statements that information matters for future work** — and requests
like "remember this" or "take note" — are **immediate persistence triggers**
that override the agent's discretion about whether to persist. They do not
override the duties to select the smallest useful abstraction, use the
correct canonical home, and respect privacy and safety boundaries.

### Memory checkpoint

Before completing meaningful work: identify durable findings, persist them
in their canonical home, update relevant pointers, and correct or prune
stale memory. Trivial chat, minor lookups, and work that produced no durable
information require no filesystem update.

Routine memory maintenance does not require separate permission, but still
respects read-only mode, sensitive information, and normal approval
boundaries for product or runtime changes.

### Canonical homes

| Type of knowledge | Home |
|---|---|
| Project purpose, north star, scope boundary | This file (`AGENTS.md`) |
| Current status, blockers, next actions | `PROJECT_OVERVIEW.md` |
| Architecture, design decisions, specs | `docs/` (named design docs) |
| Feature lifecycle (idea → plan → evidence) | `docs/feature-impl/<date>-<name>/` |
| Working hypotheses, volatile findings | Session workpad or working file (not here) |
| Task-level status | Task document or worker report |

## Startup Routine

1. Read `PROJECT_OVERVIEW.md` for current state.
2. Read the relevant design doc(s) for the work thread you're entering.
3. Check `git log --oneline -10` for recent commits.
4. Check `git status` for uncommitted WIP.
5. If the work touches injection policy, read `docs/spec-hard-delete-transient-injection.md`.
6. If the work touches user-pin, read `docs/design-user-pinned-directive.md` and `docs/requirements-user-pin-emphasis-and-semantics.md`.

## Development Workflow

```sh
npm install
npm run typecheck    # tsc --noEmit
npm test            # vitest run
npm run precommit   # typecheck + test + npm audit --audit-level=moderate
```

Interactive test: `pi -e ./index.ts`

## Risks and Open Knowledge Gaps

- **Cache behavior:** Provider-specific cache miss signals observed on
  Gemini 3.7/3.8 with sheet changes; not yet fully characterized across
  providers. See `docs/cache-test-matrix.md`.
- **Weak-model retention:** Whether `scheduled:N` cadence preserves
  steering effectively on weaker models is unmeasured.
- **Feature-impl directories:** `docs/feature-impl/` holds `20261021-user-pin-submit/` and `20260717-compass-notice/` (TUI-only steering notice). The user-pin emphasis WIP is still in root docs, not yet backfilled.
- **No AGENTS.md existed before this bootstrap** — earlier sessions had no
  pairing memory anchor.

## Boundaries

- Do not store secrets or credentials in pairing memory.
- Do not implement product/code changes as part of memory maintenance.
- Keep raw/private evidence in git-ignored areas (`.herdr-*-report.md`,
  `cg-task-result-*.md`, `extracted-workpads/`).
- The `agent/` directory (if created) is for internal scratch only; durable
  memory lives in repository-owned files.
- Time-sensitive notes should carry a date for freshness judgment.
