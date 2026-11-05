---
name: repo-maintenance
description: Self-sufficient routine for dependency upgrades, audit hygiene and verified push in this repository. For agents working on this repo; never deployed to extension users.
---

# Repository maintenance routine (self-sufficient)

This skill is the single source of truth for maintaining this repository.
It must remain fully self-sufficient: never depend on resources outside
this repository (no central skill, no external memory).

## Goal & hard rules
- All npm dependencies at latest published versions, MAJOR bumps included.
- npm audit green (exit 0), fixed at ROOT CAUSE (upgrade the vulnerable
  package itself). Never via: lowered audit level, --force, npm audit
  ignore/suppressions, overrides that mask advisories, or downgrade-to-dodge.
- NO restrictions may be loosened to get green. If a temporary measure is
  truly unavoidable, flag it explicitly in the evidence file and name the
  real fix.
- Never bend a test to pass. Failures are either pre-existing (prove it via
  a stash/HEAD baseline) or regressions (fix root cause or stop and report).

## Procedure
1. git fetch origin; ensure local branch is even with origin before starting.
2. Record BEFORE-state: package versions (npm ls --depth=0), npm audit
   output, full test verdict on the clean tree.
3. Bump deps to latest (majors included). Regenerate lockfile fresh
   (remove package-lock.json, npm install).
4. Typecheck/build + full test suite. Compare against BEFORE-state; any
   new failure is a regression. Investigate root cause before touching code.
5. npm audit must exit 0.
6. Commit (conventional message) and push ONLY when: tests no worse than
   baseline, audit exit 0, tree clean.

## Evidence contract
Commit agent/dep-refresh-YYYYMMDD.md containing: before/after table per
changed package, audit before/after, test verdict incl. pre-existing
failures with proof they pre-date the change, residual risks/overrides
kept and why.

## Acceptance protocol (verifier duties - NEVER trust a worker self-report)
- git fetch, then HEAD == origin on the working branch
- zero dirty tracked files
- re-run npm audit (expect exit 0)
- inspect the diff for loosened restrictions (audit config, skipped
  tests, downgraded pins)
- spot-check the evidence file exists and matches reality

## Repo-specific facts
- Commands (from package.json): `npm run typecheck` (`tsc --noEmit`),
  `npm test` (`vitest run`), `npm run precommit` (typecheck + full test
  run + `npm audit --audit-level=moderate`). Run `npm run precommit` as the
  pre-push gate.
- No engines field; TypeScript 7, Node types v26, vitest 5. A current LTS
  Node 22 works (dev runs on v22.x). No build step: tsconfig is `noEmit`,
  extension source ships as-is (`pi.extensions: ["./index.ts"]`).
- Dependency set is small: only devDependencies plus peerDependencies
  (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`,
  `@sinclair/typebox`), no regular dependencies. Peer versions track dev
  versions (currently ^1.5.0 / ^1.5.0 / ^0.34.52) and must keep moving in
  lockstep on bumps, per commit `08986db`.
- `overrides` pin `postcss` 8.5.28 and `fast-uri` 3.1.8 (introduced in
  `1b4a607`). These are TRANSITIONAL audit fixes, not policy: `postcss`
  resolves under vite (peer of vitest) and was pinned below a released fix
  while no higher version existed — re-check after each lockfile
  regeneration and remove the override once a fixed version is available.
  The `fast-uri` override has no trace in the current lockfile — verify
  whether it still resolves anything before a campaign, and drop it if
  inert. (Verified 2026-11-05: `npm explain fast-uri` reports "No
  dependencies found"; `npm explain postcss` confirms the override is
  active.)
- Current baseline: audit exit 0, 106 tests, tree clean (last full refresh
  `20ed590`).
