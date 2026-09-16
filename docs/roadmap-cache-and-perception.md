# Workpad: cache handling vs. what the LLM perceives

Decision map updated 2026-09-16. Shipped source is unchanged at `8ab3870`.
Narrative history and the audit trail of retracted claims live in
`20260911_workpad-voice-and-frame_1_PLAN.md`; this file is the current map.

Legend: **SOLVED** done and verified · **ACCEPTED** will not be solved here, by choice ·
**OPEN** needs an experiment, not more reading · **BLIND** we cannot currently see it.

## 0. North star and non-negotiable requirements

The workpad is the agent's current sheet of paper: its latest goal, focus, next actions,
blockers, and durable steering notes must remain at the attention frontier so it can
self-organize during long work. It is not project memory or a task tracker.

Any delivery design must preserve all of these properties:

1. **Frontier recency:** current state must not sink into old tool-call history.
2. **Self-ownership without repetition:** it reads as the agent's own state and does not
   provoke echoing, acknowledgement, or multiple stale sheets.
3. **Actionable guidance:** list bodies remain available until evidence shows a smaller
   pointer preserves next-action execution.
4. **Durability:** the latest snapshot survives reload, branching, and compaction.
5. **Provider-safe caching:** no demonstrated forced re-read of an already-sent prefix;
   provider-specific cache assumptions cannot justify a generic message-layout change.

Removing the live frontier sheet fails requirements 1 and 3. Moving it is not acceptable
unless the replacement is measured against all five requirements.

### 0.1 Current destination and decision boundary

No redesign is selected and the source remains at `8ab3870`. The current **hold** now means “do not
ship an unmeasured fix,” not “no cache issue was found”: run-unique replications on Gemini 3.7 and 3.8
reproduced a warm-prefix miss when only the synthetic trailing sheet changed.

That provider-specific signal reopens the experimental path, not generic implementation. A source
change still requires a controlled alternative that removes or materially reduces the miss without
weakening frontier recency, self-ownership, actionable guidance, durability, or other provider paths.
Concrete steering failures remain an independent gate.

While that follow-up is pending:

- do not remove the live sheet for cache tidiness;
- do not generalize one provider's result to another or reorder messages on speculative cache benefit;
- do not use provider-payload surgery, fabricated tool events, or synthetic history as a workaround;
- do not turn the workpad into project memory, an activity log, or a task tracker; and
- do not modify `src/` without a gate signal and an acceptance test covering the affected requirement.

Assistant-before-user and system-prompt placement remain experimental arms only, not chosen designs.
The next legitimate cache work is to compare those arms with the current tail layout on the exact
Gemini 3.7/3.8 routes while preserving all five requirements.

---

## 1. Where we stand: anatomy of one request

The workpad exists in three places at once. Only two reach the model. In Pi's Anthropic
adapter, the transient copy also carries the deepest explicit cache marker; other providers
use different cache mechanisms, so this is request anatomy, not a universal cost model.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ tools[]            ≤1 explicit breakpoint · stable                          │
│ system             ≤1 explicit breakpoint · stable                          │
│ messages 0..N-2    every past turn: tool_call args ①, tool results ②        │
├────────────────────────────────────────────────────────────────────────────┤
│ messages[N-1]      last REAL message (tool_result / user reply)             │
├────────────────────────────────────────────────────────────────────────────┤
│ messages[N]        THE SHEET ③   role custom → user, appended last,          │
│   └─ cache_control EPHEMERAL ★   ← deepest message-level breakpoint          │
│                    request-local: never persisted                            │
└────────────────────────────────────────────────────────────────────────────┘
      ★ sits ON the sheet in the Anthropic explicit-marker adapter. This is
        formally non-monotonic. One controlled direct-Haiku run retained the
        stable prefix and rewrote only the 44-token changed tail; do not generalize it.
```

Re-derived from source, not from memory:

| Mechanic | Location |
| --- | --- |
| Injected block is removed and re-appended each turn, so exactly one sheet ever exists | `src/mini-self-org.ts:308-316` |
| `role:"custom"` is converted to `role:"user"` on the way to the LLM | `chunk-JVUZSMYM.js`, `convertToLlm` |
| Exactly one **message-level** `cache_control`, on the last block of the last message, and only if that message is `user` (separate tool/system markers may also exist) | `anthropic-messages-*.js`, `convertMessages` |
| `toolResult.details` is never serialized into the provider request | same converter; `details` is absent from every emitted block type |
| History reconstruction reads persisted `details`, and `getBranch` walks leaf→root over **all** entries | `src/mini-self-org.ts:112,165`; `session-manager.js:953-966` |

## 2. The three copies

| # | Where | Reaches LLM | Persists | Verdict |
| --- | --- | --- | --- | --- |
| ① | `tool_call` args of every past write | yes, inside the cached prefix | yes | **ACCEPTED** duplication. Also the only in-context proof the state is the agent's *own* prior act — see §4.2 |
| ② | `toolResult.details.snapshot` | **never** | yes, survives compaction | **SOLVED.** Durable, invisible to the provider, and what reconstruction reads |
| ③ | The injected sheet | yes, every turn | no | Live frontier view; also the deepest explicit marker in Pi's Anthropic adapter. Exact-model probes now include retained-prefix, delayed-hit, no-hit, and first-B-miss outcomes; Bedrock remains unmeasured. |

## 3. Cache behavior: what is measured and what is not

The sheet changes when steering state changes and is request-local. Cache behavior must be
separated by adapter; Pi 0.85.1 does not emit one provider-neutral cache shape. The five adapter-
family rows below explain mechanics; the exhaustive status of all **57 currently selectable provider
IDs / 711 model entries** is maintained in `docs/cache-test-matrix.md`.

| Pi 0.85.1 path | Request-side mechanism observed in installed source | What the current evidence establishes |
| --- | --- | --- |
| Anthropic Messages | Explicit `cache_control` on system/tools and the last block of the last `user` message | One controlled direct Haiku 4.5 run retained 4,338 cached prefix tokens and wrote 44 when only the synthetic tail changed; its repeat read 4,382. Provider/model-specific, not universal. |
| Bedrock Converse + supported Claude | Explicit system and final-user `cachePoint` blocks | Same placement concern, but no project measurement. Nova is documented in Pi source as automatic instead. |
| OpenAI Responses / Codex / GitHub Copilot | Pi sends a session-derived `prompt_cache_key`; no Anthropic-style per-message marker | The historical Codex sample showed no read cliff. One controlled Copilot Terra run with a fixed key retained 7,132 cached prefix tokens and wrote 20 across the tail change; its repeat read 7,152. |
| Google Generative AI | No explicit cached-content reference in Pi's request object; maps provider cache-hit usage into `cacheRead` | Exact models differed: 3.5 retained 4,074; run-unique replications confirmed first-B misses for 3.7 and 3.8; 3.6 repeatedly never hit; 2.5 was B2-only twice. |
| OpenAI-compatible / Mistral | Compatibility-dependent request fields; adapters can consume cached-token accounting | Wafer DeepSeek V4 Flash retained 6,912 on first B in two valid runs. Cerebras qwen-3.8 had one first-B miss, then two run-unique 7,168-token first-B hits. Other providers and siblings remain unmeasured. |

Official provider documentation agrees on the important boundary, not on one common mechanism:
Anthropic supports automatic caching or block-level explicit breakpoints; OpenAI reuses eligible
prefixes and treats `prompt_cache_key` as routing/accounting rather than a hit guarantee; Gemini
implicit caching rewards a common prompt prefix. Sources: [Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching),
[OpenAI prompt caching](https://platform.openai.com/docs/guides/prompt-caching), and
[Gemini context caching](https://ai.google.dev/gemini-api/docs/caching).

**Measured read side, one historical OpenAI Codex session:** direct re-analysis of
`2026-08-30T12-02-37-198Z_01a0528c-*.jsonl` found that all 524 assistant responses, including
all 50 responses immediately after a workpad result, recorded API `openai-codex-responses`,
provider `openai-codex`, and model `gpt-5.6-terra`.
Those 50 had median 1,122.5 uncached input tokens versus 1,438 on 428 ordinary follow-ups;
`cacheRead` was non-decreasing in 47/49 consecutive post-write comparisons. A full-context
re-read cliff was not observed **on that Codex path**. The whole persisted workpad footprint
was **0.48%** of the 7.93 MB session. The earlier label “Anthropic-path” was wrong.

**Historical Anthropic counters exist, but not for this feature:** six Anthropic responses across
three January 2026 session files include nonzero `cacheRead`/`cacheWrite` values, proving that the
session format can carry those counters. None of the three files contains a mini-self-org call or
result, and no serialized request payload was persisted, so they provide **zero workpad-tail evidence**.

**Measured Gemini probes, bounded and model-specific:** all exact payload controls passed. Gemini
3.5 Flash retained `4074` cached tokens across first B. Gemini 3.7 and 3.8 each produced two valid,
run-unique A2 `4074` hit → first-B zero → B2 `4074` hit sequences: their first-B misses are replicated,
not one-off payload drift. Gemini 3.6 reported no hits in both its original and run-unique repeat. The
two earlier 2.5 Flash runs produced only B2 hits (`6111`). These differences under one provider ID
forbid a provider-wide verdict; the harness does not reveal whether the repeated misses arise from
model-specific prefix matching, routing, or provider policy.

**Measured OpenAI-compatible probes, bounded and model-specific:** Wafer DeepSeek V4 Flash retained
`6912` cached prefix tokens on first B in both the original first-ever-tail run and a run-unique repeat.
Cerebras qwen-3.8-27b produced one original A2 `7168` hit → B1 zero → B2 `7168` hit sequence, followed
by two run-unique replications that retained `7168` on first B. The Cerebras miss is therefore real but
not deterministic. Its two sibling models remain untested.

**Replication correction:** the first repeat batch reused the original literal A/B tail values. Because
those exact payloads could hit prior-run cache entries, those five complete sequences are retained only
as calibrations and excluded from A→B classification. The harness now derives equal-length A/B tails
from the unique run ID; all replication claims above use those contamination-resistant runs.

**Still unknown:** Bedrock behavior with the volatile explicit final-user breakpoint; external validity
outside the exact routes/build; real-workpad write amplification outside the synthetic fixture; why
Gemini 3.7/3.8 consistently miss first B; and why Cerebras routing is mixed. Therefore:

- do not claim that the transient tail kills caching;
- do not transfer Codex cache results to Anthropic, Bedrock, Gemini, or compatible APIs;
- do not claim universal cache safety from one provider-path observation;
- do not reorder messages for cache reasons without provider-spanning evidence;
- retain the live frontier sheet because it is the feature, not incidental overhead.

## 4. Issue ledger

### 4.1 SOLVED

- **Durability across reload and compaction.** `reconstructSnapshot` reads persisted `details`
  via `getBranch`, which includes every entry back to the root; compaction summarises LLM
  context, not the branch. Independent of injection. Verified.
- **Duplication of *durable* state.** ② reaches neither the provider nor the bill. The earlier
  belief that snapshot persistence was itself a cost was wrong.
- **Multiple stale sheets.** One block per turn, enforced by filtering before append.

### 4.2 ACCEPTED — will not be solved here

- **Duplicate copies in ①.** Full snapshots stay in every historical `tool_call` arg. Their
  persisted size was 0.48% in the measured session, and no behavioral or provider-cost harm has
  been demonstrated. Slimming them would also remove the model's own record of what it wrote,
  creating an unmeasured self-ownership risk. Hold rather than change one unmeasured trade-off
  for another.

### 4.3 OPEN — needs a run, not more reading

- **Provider-specific tail misses on Gemini 3.7/3.8.** Two run-unique sequences per exact model
  reproduced A2 hit → first-B miss → B2 hit when only the synthetic final sheet changed. Compare the
  current layout with assistant-before-user and system-prompt arms on these routes; do not change
  `src/` until one arm improves cache behavior without failing the five requirements.
- **Whether framing changes the acknowledgement tic, and why the tic concentrates.** Workpad-active
  sessions show a strong association (**3.4%** vs **0.0%** across 64,613 assistant messages without
  it), but the observational cohorts do not prove causality. Natural sessions also cannot isolate
  phrasing: rates cluster by session, and the small controlled run had zero strict acknowledgements
  in either arm. The same-day pair `01a08f1d` (18.2%) vs `01a08f56` (79.6%) shows write count and
  model selection alone do not explain the variance; context saturation, compaction, and stochastic
  behavior remain candidates.
- **Whether any alternative placement improves self-ownership without weakening frontier
  guidance or provider portability.** The §7 assistant-before-user layout remains an exploratory
  semantic arm only; it is not a provider-agnostic cache fix.
- **Whether list bodies leaving context degrades next-action execution.** Never tested.

### 4.4 BLIND — not observable today

- **Bedrock and long-run external validity.** No Bedrock run exists, and one synthetic direct-
  Anthropic/Terra sequence cannot establish behavior across accounts, regions, prompts, or future builds.
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
| **G1** | Run the staged OLD/NEW/OFF protocol in §6b with identical task seeds and clean trajectories | Whether injection or wording changes strict acknowledgement behavior | Baseline first; power a comparison only after observing a non-trivial event rate |
| **G2** | Re-measure workpad bytes / session bytes and read cliffs **per adapter/model** | Whether the sheet has become worth engineering for on a specific provider path | Read-only over session data; never pool provider paths |
| **G3** | Watch for a concrete behavioural failure, defined in advance | Whether ①'s duplication is buying something real | Observation in normal use |
| **G4** | Upstream: expose stable/volatile context metadata to provider adapters | Whether explicit-cache providers can anchor before volatile context without changing semantic placement | Outside this repo; justified only after measured write-side or provider-specific harm |
| **G5** | Use `test-lab/cache-probe*` to capture controlled serialized payload hashes plus read/write usage | Whether a tail-only change causes misses or write amplification on each adapter | Retention: Haiku, Copilot Terra, Wafer, Gemini 3.5. Replicated first-B misses: Gemini 3.7/3.8. Mixed: Cerebras qwen-3.8. Delayed/no-hit: Gemini 2.5/3.6. Bedrock unrun; never pool paths. |

**Standing rule:** no change to `src/` without a gate signal. Both redesign proposals made so
far were requested before the symptom they addressed had ever been measured, and both were
withdrawn afterwards. The gate table exists to make that failure mode expensive to repeat.

## 6a. Where the A/B actually stands (2026-09-14)

What the 2026-09-14 write-driving runs established, before the wording comparison was measured:

- **Session continuation works across separate `pi -p` processes** on one `--session-id`: the
  `w-OLD` arm stepped `messagesBefore` 1→6→11→…→56, +5 per turn (user + workpad toolCall +
  toolResult + … pattern), 4 requests per turn group.
- **Corrigendum (2026-09-14, verified from session files): the "needs the tool named" bullet is
  retracted.** The 12 unnamed-prompt turns that produced 0 workpad calls were all **`500 litellm
  Connection error` endpoint stubs** (`stopReason:"error"`, 0 tokens) — the local home-llm
  endpoint was down from `w-OLD` (07:43) through `probe`/`w2-OLD` (07:49). They prove nothing about
  prompt phrasing. Once the `w-OLD` session continued on **cerebras/qwen-3.8-27b** (user-instructed
  model switch, 07:51:30), the *same unnamed* generic phrasing ("Update your workpad (goal and
  current focus) to reflect what you are doing now…") yielded **16 workpad tool calls** (OLD) and
  **13** (NEW) across the completed 12-turn cerebras runs (§6a) — naming is not a necessity
  for this model. The local model's phrasing sensitivity remains an open question: it emitted no
  non-error output at all on 09-14, so there is no datum for it.
- Preamble size already settled separately: `NEW` framing is **−83 B/request** vs `OLD` (283 B vs
  366 B), because the tool-name clause dropped (−161 B) outweighs the anti-acknowledgement clause
  (+78 B). Size was never the behavior lever; acknowledgement rate remains open.
- **The trajectories were not matched.** OLD recorded 100 requests, 62 home-llm errors, 21 Cerebras
  errors, and context growth from 1→166 messages. NEW recorded 45 requests, 14 Cerebras errors,
  and growth from 1→83. Each arm has 31 successful Cerebras responses, but equal successful counts
  do not erase the different histories and retry/error exposure.
- **`test-lab/tic-metrics.py` is historical exploratory tooling, not the decision metric.** It scans
  strong and weak markers together and counts any `workpad`, `scratchpad`, or `mini-self-org` mention
  as a `tic_turn` (`:36,108-115,132`). Loose mentions must remain secondary; they are not strict
  acknowledgements.
- Environment: macOS has no `timeout` binary (exit 127) — arm scripts must not gate on it.

Status: the completed 12-turn Cerebras runs delivered the sheet but did **not** settle the wording
question. Strict acknowledgements were 0 in both arms; loose mentions were 5/31 (OLD) vs 3/31 (NEW),
but the sample is small and the trajectories are contaminated. NEW's only attributable result is
request size (−83 B/request). G1 remains open, and no `src/` change is signalled.

## 6b. Contract for the next valid behavior experiment

Do not retrofit a significance claim onto the contaminated runs, and do not fix a final sample size
before establishing that identical neutral tasks produce a measurable baseline event rate.

**Frozen controls for every arm:** commit and Pi build, fixture checksum, provider/model and sampling
settings, tool set, neutral task corpus and seeds, scorer version, retry budget, and fresh-session policy.
Run OLD, NEW, and OFF in randomized/interleaved order. A provider/config change, unequal retry handling,
missing trace, or context-history divergence invalidates that replicate; do not pool providers.

**Stage 1 — baseline gate:**

- collect 50 scored generations per arm across fresh, balanced sessions using identical task seeds;
- primary outcome is a pre-registered **strict semantic acknowledgement** rubric, rated blind by two
  independent scorers, with disagreements adjudicated before unblinding;
- report agreement, strict events, transport errors, workpad-call rate, task correctness, and loose
  mentions separately; and
- if OLD and OFF both remain below 5% strict acknowledgements (for example, ≤2/50), stop. Neutral tasks
  do not expose the behavior often enough to test a reduction; design a pre-registered stress corpus
  rather than declaring “no effect.”

**Stage 2 — comparison only after the gate:** estimate the required OLD-vs-NEW sample from the observed
baseline rate for 80% power at α=0.05. Pre-register the minimum meaningful absolute and relative effect
then; do not use a fixed 5-point or 50% threshold when the baseline could make it impossible or undefined.
Keep OFF as a reference for injection association.

**Separate next-action experiment:** seed the same complete snapshot, apply identical intervening
context/tool load, then ask for the next action without restating it. Compare complete list bodies with
a pointer/omitted-body arm against a fixed oracle. Do not combine this with the framing experiment.

## 6c. G5 runtime probe (2026-09-16)

`test-lab/cache-probe.ts` and `test-lab/cache-probe-run.sh` are non-shipped measurement tooling;
the bounded hashes, controls, counters, and limitations are persisted in
`docs/cache-probe-evidence-2026-09-16.json`. They run four independent stateless requests: A1/A2
with one synthetic sheet tail, then B1/B2 with
another. A stable system anchor keeps the cacheable prefix above provider minimums. Every request
records only hashes, lengths, structural shape, marker paths, and usage; no prompt text, headers, or
credentials. Raw hashes must satisfy A1=A2, B1=B2, and A≠B, while a copy with exactly the expected tail
replaced by a sentinel must hash identically across all four. Live execution requires an explicit
confirmation string and stops between calls on missing or ambiguous evidence.

**Anthropic:** the funded complete `claude-haiku-4-5` run verifies `cache_control` on the system
block and final message in all four requests. A1 wrote 4,382 cache tokens; A2 read 4,382. After only
the synthetic tail changed, B1 still read 4,338 and wrote 44; B2 read 4,382. The earlier credit-
blocked A1 remains in the evidence artifact as superseded audit history. This is strong bounded
evidence that the volatile final breakpoint did not force a full-prefix rewrite in this run.

**GitHub Copilot / GPT-5.6 Terra:** an initial calibration correctly stopped after A2 because Pi's
fresh in-memory sessions produced different serialized `prompt_cache_key` values. The final profile
uses the same explicit **non-persisted** session ID for each process, stabilizing that real routing
input without replaying conversation history. The controlled run then passed every hash: A1/A2 each
read 7,153 tokens; after only the tail changed, B1 read 7,132 and wrote 20; B2 read 7,152. This is
bounded evidence against the reported full-cache-loss concern on this exact path and build.

**Gemini:** all requested runs and run-unique replications passed every structural control. Outcomes
differ by exact model: 3.5 retained `4074` across A2→B1; 3.7 and 3.8 each reproduced A2 `4074` hit
→ B1 zero → B2 `4074` hit in two valid sequences; 3.6 repeatedly never hit; 2.5 was B2-only twice.
The provider ID therefore has **mixed** evidence, with replicated adverse behavior on 3.7 and 3.8.

**OpenAI-compatible endpoints:** Wafer's only listed model, `DeepSeek-V4-Flash-0731-Fast`, retained
`6912` on first B in the original and a run-unique replication. Cerebras `qwen-3.8-27b` produced one
first-B miss followed by two run-unique `7168`-token first-B hits, so its behavior is mixed rather than
a deterministic tail failure. Its `gemma-4-31b` and `gpt-oss-120b` siblings remain untested. An initial
Wafer A1 rejected unsupported `minimal` reasoning and safely stopped; successful runs used `low`.

G5 now triggers a **provider-specific follow-up** for Gemini 3.7/3.8: the first-B miss is replicated
and cannot be dismissed as one anomalous run. It still does not select a generic source change because
no alternative placement has been measured against semantic requirements or other providers. Keep
`src/` frozen while testing candidate layouts on these exact routes; Bedrock and future builds remain open.

**Harness boundary:** Pi's supported `before_provider_request` hook is observational; extension errors
are caught and cannot abort before the first transport. A1 is therefore an explicit one-call canary.
The shell validates A1 before any later call. Do not add `process.exit`, malformed payloads, payload
mutation, or other abort workarounds.

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
  At the time, the Anthropic path answered `400 credit balance too low` (later superseded by the
  funded controlled run in §6c). Local models report
  `cacheRead`/`cacheWrite` = 0 on every row. Endpoint health: `qwen38-flashnext-twins-direct`
  answers, `qwen3.8-27b-...-direct` returns 500, `qwen3.8-27b-...dflash2` returns 404.
- **The extension works from source under `-ne -e`.** The nested agent registered the tool and
  called it unprompted: 4 writes, persisted snapshots median 544 B (max 584 B), write arguments
  totalling 1,977 B.
- **The sheet travels after a write.** Inside one turn, consecutive requests stepped
  4,236 → 5,039 input tokens with no user input between them.

### What it did **not** establish

- **Cache cost — unmeasurable in that run.** Of the paths exercised in this A/B, only the then-
  unreachable Anthropic path would stamp `cache_control`; local models expose no cache counters.
  The later funded G5 run in §6c supersedes this limitation for direct Haiku only.
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
exposure — write-side amplification cannot be answered in this environment.

## 7. Sheet position: exploratory semantic arm, not a cache fix (2026-09-14)

This layout was explored as an in-repo alternative. It may improve the sheet's assistant-owned
voice, but its cache argument depends on one adapter's explicit-marker behavior. Moving volatile
content earlier can shorten the reusable prefix for automatic-prefix providers. It is therefore
**not** the active design and **not** provider-agnostic cache evidence.

### The placement

Today: `[…history…, user: task, user: sheet]` → the sheet is the last `user` message and carries
the only breakpoint (§3). Proposed:

[...history…, assistant: sheet, user: task]

The sheet rides **before** the final real user message, in **assistant** role.

Properties:

- **Ends at the user message.** Requests that end in an `assistant` message are prefill behaviour
  some providers (Anthropic) accept and others reject — that is why "trailing assistant" is ruled
  out for a provider-agnostic design. Prepending the sheet keeps the terminating role `user`
  everywhere.
- **Adapter-specific cache effect.** Pi's Anthropic adapter would stamp `cache_control` on the
  task rather than the sheet. No write-side measurement shows that this improves cost, while
  moving the changing sheet earlier may reduce reuse under automatic-prefix caching.
- **Clarity.** The model reads the sheet as its own prior voice immediately before the user's new
  request — the strongest position for the "own paper, not injected instruction" perception this
  work exists for (cf. §4.2 on why self-voice evidence is load-bearing).

### The merge rule (keeps it provider-agnostic)

- Prior message is a `toolResult` → insert a fresh `assistant` sheet message (alternation clean).
- Prior message is plain `assistant` text → **append the sheet as the final text block of that
  message** (request-local copy) rather than inserting, to avoid consecutive same-role messages,
  which Anthropic-tier APIs reject.

Either way: alternating roles, ending at `user`.

### Implementability in pi 0.85.1 (grounded, read from source)

- `convertToLlm` passes `role: "assistant"` through unchanged; only `custom` is hard-mapped to
  `user` (bundle chunk `JVUZSMYM.js`).
- The `context` extension event returns a deep copy of messages for non-destructive modification and
  is request-local — never persisted (our sheet already rides exactly this channel, and nothing in
  this design adds an `appendMessage` call).
- No new upstream mechanism is required: reorder/insert/append inside the returned copy uses the
  same hook the current sheet uses.

### Unverified — what would be required to reopen it

1. **Insertion support:** prove Pi honors the inserted/merged assistant block.
2. **Behavior:** show less role dissonance without worse next-action execution over 30+ turns.
3. **Provider safety:** compare serialized requests and available cache metrics across explicit-
   boundary and automatic-prefix provider paths. No cache benefit is assumed before that evidence.

### Alternate channel, for A/B, not as replacement

A `systemPromptOptions` extension can append the sheet to the system prompt instead — also
provider-agnostic — but in system voice, which weakens the §4.2 ownness argument. Candidate third
arm (`user-trailing` / `assistant-before-user` / `system`) if the insertion arm above works.

## 8. How to read this document against the rest

- `docs/roadmap-cache-and-perception.md` — this map: standing picture, ledger, gates; §7 is the
  2026-09-14 placement candidate (assistant-before-user).
- `docs/cache-probe-evidence-2026-09-16.json` — bounded G5 harness hashes, structural controls,
  usage counters, and non-causal conclusions; raw local JSONL paths are identified but ignored.
- `docs/cache-test-matrix.md` — exhaustive dated coverage map for all provider IDs currently
  selectable in this Pi profile; exact tested models are separated from untested siblings.
- `20260911_workpad-voice-and-frame_1_PLAN.md` — how we got here, including two committed
  figures that were wrong and are corrected in `e5a4097` / `0231c64`. Read it before re-opening
  any gate, so a retracted claim does not resurface as a premise.
