# pi-mini-self-org

A bounded Pi extension for keeping one agent's current session workpad visible and request-local.

## Install

```sh
pi install https://github.com/cgint/pi-mini-self-org
```

## What it keeps

The `mini-self-org-workpad` tool (label: **Mini self-org workpad**) atomically replaces a complete snapshot containing `goal`, `nextActions`, `blockers`, and `notes`.

The `mini-self-org-history` tool (label: **Mini self-org focus history**) reads a bounded, newest-last timeline of this branch's past workpad snapshots (timestamps, which fields changed, cleared states). It is read-only and non-authoritative: a re-orientation aid, not project memory, not task tracking, and never a replacement for a workpad update.

It is not project memory, durable cross-session planning or task tracking, or an automatic state update.

## Use

Use the workpad at meaningful state boundaries. If it becomes stale, replace the complete snapshot before the next consequential action batch; do not update it ritualistically after every tool call.

**Exact tool names:** The registered tools are `mini-self-org-workpad` and `mini-self-org-history`. `workpad` is not an alias and is never callable. `nextActions`, `blockers`, and `notes` are arrays, not JSON-encoded array strings.

The model receives one request-local, non-authoritative current block until it is replaced or cleared. The TUI renderer shows the normalized snapshot, while tool-result details persist active-branch recovery.

Current sessions use `mini-self-org-workpad`. Legacy `workpad` result snapshots remain readable only for recovery; this does not create a callable legacy alias.

## Session and privacy boundary

Snapshots are stored in Pi session tool-result details for active-branch recovery. They are session-local state, not external storage or shared project memory. Treat workpad content as session content and avoid placing secrets or unnecessary personal data in it. The focus history view is derived from these same details at read time — it adds no new storage.

## Optional force mode

Start Pi with `--mini-self-org-force`, or use `/mini-self-org-force-on` and `/mini-self-org-force-off`. Force mode is off by default.

When enabled, it gates tool calls: a standalone successful current workpad result is required before another tool call. It cannot mechanically block text-only replies. Pi preflights sibling action calls, so a workpad call and action calls in the same batch leave the action siblings blocked. Read-only `mini-self-org-history` calls are exempt from the gate, but a history result never satisfies the due workpad update.

## Commands

- `/mini-self-org` — read-only view of the current workpad.
- `/mini-self-org-history` — read-only view of the branch's focus history (past workpad snapshots).
- `/mini-self-org-force-on` — enable the session-local tool gate.
- `/mini-self-org-force-off` — disable the session-local tool gate.

## Development

```sh
npm install
npm run typecheck
npm test
npm run precommit
```

For an interactive check:

```sh
pi -e ./index.ts
```
