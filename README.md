# pi-mini-self-org

A bounded Pi extension for keeping one agent's current session workpad visible and request-local.

## Install

```sh
pi install https://github.com/cgint/pi-mini-self-org
```

## What it keeps

The `mini-self-org-workpad` tool (label: **Mini self-org workpad**) atomically replaces a complete snapshot containing `goal`, `nextActions`, `blockers`, and `notes`.

It is not project memory, durable cross-session planning or task tracking, or an automatic state update.

## Use

Use the workpad at meaningful state boundaries. If it becomes stale, replace the complete snapshot before the next consequential action batch; do not update it ritualistically after every tool call.

**Exact tool name:** Call `mini-self-org-workpad` only. `workpad` is not an alias and is never callable. `nextActions`, `blockers`, and `notes` are arrays, not JSON-encoded array strings.

The model receives one request-local, non-authoritative current block until it is replaced or cleared. The TUI renderer shows the normalized snapshot, while tool-result details persist active-branch recovery.

Current sessions use `mini-self-org-workpad`. Legacy `workpad` result snapshots remain readable only for recovery; this does not create a callable legacy alias.

## Session and privacy boundary

Snapshots are stored in Pi session tool-result details for active-branch recovery. They are session-local state, not external storage or shared project memory. Treat workpad content as session content and avoid placing secrets or unnecessary personal data in it.

## Optional force mode

Start Pi with `--mini-self-org-force`, or use `/mini-self-org-force-on` and `/mini-self-org-force-off`. Force mode is off by default.

When enabled, it gates tool calls: a standalone successful current workpad result is required before another tool call. It cannot mechanically block text-only replies. Pi preflights sibling action calls, so a workpad call and action calls in the same batch leave the action siblings blocked.

## Commands

- `/mini-self-org` — read-only view of the current workpad.
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
