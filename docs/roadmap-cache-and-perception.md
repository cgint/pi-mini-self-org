# Workpad: cache handling vs. what the LLM perceives

Status picture and roadmap as of 2026-09-11. Source is unchanged at `8ab3870`.
Narrative history and the audit trail of retracted claims live in
`20260911_workpad-voice-and-frame_1_PLAN.md`; this file is only the current map.

Legend: **SOLVED** done and verified · **ACCEPTED** will not be solved here, by choice ·
**OPEN** needs an experiment, not more reading · **BLIND** we cannot currently see it.

---

## 1. Where we stand: anatomy of one request

The workpad exists in three places at once. Only two of them reach the model, and one of
those two also happens to carry the provider's cache marker.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ tools[]            ≤1 breakpoint · stable                                   │  CACHED
│ system             ≤1 breakpoint · stable                                   │  CACHED
│ messages 0..N-2    every past turn: tool_call args ①, tool results ②        │  CACHED
├────────────────────────────────────────────────────────────────────────────┤
│ messages[N-1]      last REAL message (tool_result / user reply)             │
│   └─ cache_control EPHEMERAL ★   ← pi's ONLY breakpoint, lands here          │  ◀ boundary
├────────────────────────────────────────────────────────────────────────────┤
│ messages[N]        THE SHEET ③   role custom → user, appended last,          │  UNCACHEABLE
│                    request-local: never persisted                            │   every turn
└────────────────────────────────────────────────────────────────────────────┘
      ★ sits ON the sheet ⇒ next turn the sheet's old text is mid-context and
        unmarked ⇒ the tail is re-written from there onward
```

Re-derived from source, not from memory:

| Mechanic | Location |
| --- | --- |
| Injected block is removed and re-appended each turn, so exactly one sheet ever exists | `src/mini-self-org.ts:308-316` |
| `role:"custom"` is converted to `role:"user"` on the way to the LLM | `chunk-JVUZSMYM.js`, `convertToLlm` |
| Exactly **one** `cache_control`, on the **last block of the last message**, and **only if that message is `user`** | `anthropic-messages-*.js`, `convertMessages` |
| `toolResult.details` is never serialized into the provider request | same converter; `details` is absent from every emitted block type |
| History reconstruction reads persisted `details`, and `getBranch` walks leaf→root over **all** entries | `src/mini-self-org.ts:112,165`; `session-manager.js:953-966` |

## 2. The three copies

| # | Where | Reaches LLM | Persists | Verdict |
| --- | --- | --- | --- | --- |
| ① | `tool_call` args of every past write | yes, inside the cached prefix | yes | **ACCEPTED** duplication. Also the only in-context proof the state is the agent's *own* prior act — see §4.2 |
| ② | `toolResult.details.snapshot` | **never** | yes, survives compaction | **SOLVED.** Durable, invisible to the provider, and what reconstruction reads |
| ③ | The injected sheet | yes, every turn | no | Carries the collision: it is both the live view **and** the cache breakpoint |

## 3. The collision, stated plainly

The sheet must change whenever state changes — that is its whole purpose. Pi gives us one
cache breakpoint and places it on the last `user` message, which is the sheet. So the cache
boundary is permanently parked on the single most volatile thing we send.

Consequence: after a write, the previous turn's sheet text sits mid-context with no marker,
so Anthropic re-creates the cache from there. **The most expensive location in the request is
our cheapest, most frequently rewritten object.** Pinned one message earlier, the identical
design would churn nothing.

Measured cost of the whole arrangement: **0.48%** of a 7.93 MB session, with no read-side
re-read cliff. Structural, real, and currently small — which is why it is ACCEPTED rather than
fixed.

## 4. Issue ledger

### 4.1 SOLVED

- **Durability across reload and compaction.** `reconstructSnapshot` reads persisted `details`
  via `getBranch`, which includes every entry back to the root; compaction summarises LLM
  context, not the branch. Independent of injection. Verified.
- **Duplication of *durable* state.** ② reaches neither the provider nor the bill. The earlier
  belief that snapshot persistence was itself a cost was wrong.
- **Multiple stale sheets.** One block per turn, enforced by filtering before append.

### 4.2 ACCEPTED — will not be solved here

- **The breakpoint location** (§3). Fixable only in the provider layer, outside this repo.
  Named debt, with a reopen gate (§5).
- **Duplicate copies in ①.** Full snapshots stay in every historical `tool_call` arg. Cost is
  0.48%, and slimming them would remove the model's own record of what it wrote — the most
  trustworthy signal that this state is *its* state and not an injected instruction. Removing
  it risks reinstating exactly the "alien information" feeling that motivated this work.
  Rejected on evidence, not taste.
- **Wording as a lever for the acknowledgement tic.** The tic is caused by the injection
  (**3.4%** with the workpad active vs **0.0%** across 64,613 assistant messages without it) and
  is *not* moved by phrasing: 0.0% in every pre-2026-09-11 session, including one with 148
  writes, ~80% in two 09-11 sessions under both old and new wording.

### 4.3 OPEN — needs a run, not more reading

- **Why the tic concentrates.** Context saturation, compaction leaking self-narration, or
  something else. The same-day pair `01a08f1d` (18.2%) vs `01a08f56` (79.6%) rules out write
  count; model sets were identical, ruling out model.
- **Whether list bodies leaving context degrades next-action execution.** Never tested.

### 4.4 BLIND — not observable today

- **Anthropic write-side cache counters.** Never populated in any build reachable here, so the
  §3 re-write cost is inferred from request structure, not read from a bill.
- **Which pi build produced a past session.** Session files store schema `version: 3`, not a
  release, so the 0.48% sample is indicative rather than current.

## 5. Road to clarity: gates, not dates

Nothing below is triggered by a principle. Each gate names the measurement that reopens it, so
the default stays *hold* until data says otherwise.

```
                     ┌──────────────────────────────────────────────┐
   NOW ──────────────│ HOLD: src frozen at 8ab3870, 21 tests green  │
                     └───────────────────┬──────────────────────────┘
                                         │
      ┌──────────────────────────────────┼──────────────────────────────────┐
      ▼                                  ▼                                  ▼
 G1 offline A/B replay            G2 size watch                    G3 failure observed
 same fixed transcript,           workpad bytes > ~1% of a         state misremembered,
 only framing text varied,        session, or a measured           stale goal acted on,
 on both local models             re-read cliff                    next action dropped
      │                                  │                                  │
      ▼                                  ▼                                  ▼
 reopen FRAMING TEXT              reopen SCHEMA                    reopen DELIVERY
 (string change only;             (partial-update merge,           (candidate E: slim args)
 ≥50% tic cut to act)             slim args)                       — needs care re §4.2
```

| Gate | Experiment | Decides | Owner / reach |
| --- | --- | --- | --- |
| **G1** | Replay one long transcript against pre-fix and post-fix framing, varying nothing else | Whether wording matters at all — natural sessions cannot answer this, session-level variance swamps it | Local script + local models. Cheapest real answer available. **First attempt run 2026-09-11: too short and contaminated, see §6** |
| **G2** | Re-measure workpad bytes / session bytes; look for a re-read cliff | Whether the sheet has become worth engineering for | Read-only over session data |
| **G3** | Watch for a concrete behavioural failure, defined in advance | Whether ①'s duplication is buying something real | Observation in normal use |
| **G4** | Upstream: pin the breakpoint on the last real message rather than the injected one | Whether the §3 churn disappears without touching the design | Outside this repo; needs a pi feature or option |
| **G5** | Expose cache write counts | Whether §3's inferred cost is real | Upstream / provider; not ours to build |

**Standing rule:** no change to `src/` without a gate signal. Both redesign proposals made so
far were requested before the symptom they addressed had ever been measured, and both were
withdrawn afterwards. The gate table exists to make that failure mode expensive to repeat.

## 6. Measured: the first live A/B in this environment (2026-09-11)

Two nested `pi --print` arms over four identical turns, logs written inside the repo under
`.g1-sessions/` (ignored by `.gitignore:10`, `*.jsonl`):

```
pi -ne -e <pi-olla-autodetect>/index.ts [-e ./index.ts] \
   --session-dir .g1-sessions --session-id g1-A|g1-B \
   --model home-llm/qwen38-flashnext-twins-direct --tools read[,mini-self-org-workpad]
```

### What it established

- **Environment facts worth keeping.** `-ne` also removes the package that registers the local
  provider, so a nested run must re-add `pi-olla-autodetect` with `-e` or no model resolves at all.
  The Anthropic path answers `400 credit balance too low`. Local models report
  `cacheRead`/`cacheWrite` = 0 on every row. Endpoint health: `qwen38-flashnext-twins-direct`
  answers, `qwen3.8-27b-...-direct` returns 500, `qwen3.8-27b-...dflash2` returns 404.
- **The extension works from source under `-ne -e`.** The nested agent registered the tool and
  called it unprompted: 4 writes, persisted snapshots median 544 B (max 584 B), write arguments
  totalling 1,977 B.
- **The sheet travels after a write.** Inside one turn, consecutive requests stepped
  4,236 → 5,039 input tokens with no user input between them.

### What it did **not** establish

- **Cache cost — unmeasurable here.** Only the Anthropic path stamps `cache_control`, and it is
  unreachable on credit; local models expose no cache counters. §3 therefore stays inferred.
- **Wording effect — null with no power.** Strict injected-block acknowledgements: **0 in arm A
  and 0 in arm B**, across 4 assistant text turns each. Four turns cannot detect a rate that
  appears in long sessions; this is not evidence of no effect.
- **Extension cost — unattributable.** Arm A made 9 real requests (55,937 input tokens), arm B 7
  (32,722). The delta is **not** a price for the extension: the arms diverged behaviourally —
  only A carried the 953-char tool schema, B did an extra read, and B spent output text
  complaining the tool was absent. No chars-to-tokens conversion is offered anywhere in this file.
- **A clean control.** My turn-1 prompt named the workpad tool, so both arms mentioned it 4 times
  and arm B knew something was missing. Any future arm must use neutral prompts.

### Consequence for the gates

No gate moved. G1 needs a real fixture before it means anything: a single long fixed transcript
(30+ turns), prompts that never name the tool under test, both framings, same model and session
dir as above. The cache question needs either provider credit (G5) or upstream cache-counter
exposure — it cannot be answered in this environment at all.

## 7. How to read this document against the rest

- `docs/roadmap-cache-and-perception.md` — this map: standing picture, ledger, gates.
- `20260911_workpad-voice-and-frame_1_PLAN.md` — how we got here, including two committed
  figures that were wrong and are corrected in `e5a4097` / `0231c64`. Read it before re-opening
  any gate, so a retracted claim does not resurface as a premise.
