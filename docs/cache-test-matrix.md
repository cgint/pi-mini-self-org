# Cache test matrix

Snapshot date: **2026-09-16** · Pi runtime: **0.85.1** · inventory source: `pi --list-models`

This is the canonical coverage map for model providers currently selectable in this Pi profile:
**57 provider IDs and 711 model entries**. “Selectable” means Pi listed the entry from current auth,
configuration, or extension discovery. It does **not** prove that an endpoint is healthy, entitled, or
reachable. Dynamic catalogs and local endpoints can change; refresh the snapshot before planning a run.

The matrix unit is a **provider/endpoint ID**, not an adapter family. A result covers only the exact
named model and route in “Measured model”; sibling models remain untested even when they share a row.
Enumerating all 711 model IDs here would hide that boundary rather than clarify it.

## Status contract

| Status | Meaning |
| --- | --- |
| **CONTROLLED PASS** | A1=A2 and B1=B2 raw payloads; A≠B; all canonical hashes equal after replacing exactly one tail; warm A→B cache behavior was measured. Bounded to the named model/route/build. |
| **CONTROLLED MISS** | The controls passed and A2 proved a warm prefix, but the first changed-tail B request reported no reuse; B2 then hit. This is an adverse exact-model observation, not proof of a universal provider rule. |
| **MIXED** | Multiple exact models or valid replications of one model produced materially different controlled outcomes; inspect the run/model detail rather than assigning one uniform result. |
| **PARTIAL** | Structural controls passed, but the run lacked a warm baseline or another condition required to attribute the A→B effect. |
| **OBSERVATIONAL** | Real usage counters exist, but no controlled serialized-payload A/B was run. |
| **COUNTER-BLIND** | Requests ran in the relevant sample, but the path exposed no useful cache-read/write signal; provider/server instrumentation is required. |
| **UNRUN** | No valid cache experiment exists. Catalog visibility is not evidence. |
| **BLOCKED** | A planned test was attempted but could not reach a valid provider response; the blocker must be named. |

## Direct and subscription providers

| Provider ID | Models listed | API family in Pi | Status | Measured model | Coverage / next gate |
| --- | ---: | --- | --- | --- | --- |
| `anthropic` | 14 | Anthropic Messages | **CONTROLLED PASS** | `claude-haiku-4-5` (1/14) | Tail change retained 4,338 cached tokens and wrote 44; repeat read 4,382. Replicate and test other Claude families before widening. |
| `github-copilot` | 17 | Anthropic Messages + OpenAI Completions/Responses | **CONTROLLED PASS** | `gpt-5.6-terra` via OpenAI Responses (1/17) | Stable `prompt_cache_key`; tail change retained 7,132 and wrote 20; repeat read 7,152. Other Copilot models/transports are separate cells in substance. |
| `google` | 22 | Google Generative AI | **MIXED** | `gemini-2.5-flash`, `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash` (5/22) | 3.5 retained 4,074 across A2→B1. Run-unique replications confirmed first-B misses for 3.7 (2/2) and 3.8 (original + replication). 3.6 twice reported no hits; 2.5 was B2-only twice. |
| `google-vertex` | 14 | Google Vertex | **UNRUN** | — | Run a separate Vertex profile; do not transfer Google AI Studio results. |
| `openai` | 39 | OpenAI Responses | **UNRUN** | — | Highest-value next direct comparison: fixed cache key plus one representative cached model. |
| `openai-codex` | 8 | OpenAI Codex Responses | **OBSERVATIONAL** | `gpt-5.6-terra` (1/8) | Historical session showed no post-workpad read cliff, but build and serialized payload were not captured. Run current G5 for causal evidence. |
| `mistral` | 32 | Mistral Conversations | **UNRUN** | — | First verify request shape and whether cached-token accounting is exposed. |

## Hosted aggregators, gateways, and routed endpoints

Aggregator results must pin both the visible model ID and the actual upstream route. A provider-wide
“pass” is impossible when routing can change beneath the same provider ID.

| Provider ID | Models listed | API family in Pi | Status | Measured model | Coverage / next gate |
| --- | ---: | --- | --- | --- | --- |
| `cerebras` | 3 | OpenAI Completions | **MIXED** | `qwen-3.8-27b` (1/3) | Original run had A2 hit→B1 miss→B2 hit; two run-unique replications retained 7,168 across B1. The miss is not deterministic; `gemma-4-31b` and `gpt-oss-120b` remain untested. |
| `groq` | 7 | OpenAI Completions | **UNRUN** | — | Establish cached-token counter support, then run one pinned model. |
| `huggingface` | 75 | OpenAI Completions | **UNRUN** | — | Pin exact inference provider/model; catalog entry alone does not identify cache semantics. |
| `openrouter` | 388 | Anthropic Messages + OpenAI Completions | **UNRUN** | — | Pin `only`/route and model before testing; never pool the 388 entries. |
| `together` | 22 | OpenAI Completions | **UNRUN** | — | Establish cached-token accounting, then run one pinned model. |
| `scaleway-on-demand` | 1 | Custom OpenAI Completions | **UNRUN** | — | Verify endpoint health and cache counters before G5. |
| `wafer` | 1 | Custom OpenAI Completions | **CONTROLLED PASS** | `DeepSeek-V4-Flash-0731-Fast` (1/1) | Original and run-unique replication both retained 6,912 cached prefix tokens on first B. A fixed-tail repeat was excluded from causal scoring because it could reuse prior exact payloads. |
| `google-vertex-agent-platform` | 1 | Custom OpenAI Completions route | **UNRUN** | — | Treat separately from native Vertex; verify route and counter semantics. |
| `google-vertex-agent-platform-qwen3coder` | 1 | Custom OpenAI Completions route | **UNRUN** | — | Treat separately from native Vertex; verify route and counter semantics. |

## Local and custom OpenAI-compatible endpoints

These rows are individually selectable endpoints even when several point at similar hardware or model
families. For each, first prove that the server returns meaningful cached-token counters. If it reports
only zero/absent counters, G5 is **counter-blind** and server-side prefix-cache metrics are required.

| Provider ID | Models listed | API family in Pi | Status | Measured model | Coverage / next gate |
| --- | ---: | --- | --- | --- | --- |
| `8000-sparky-diff` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8000-sparky-vllm` | 5 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then one model. |
| `8000-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8001-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8001-sparkz` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8001-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8003-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8081-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8083-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8083-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8085-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8085-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8086-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8086-sparkz` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8086-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8087-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8087-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8090-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8888-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8888-sparkz` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8889-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `8890-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `aeon-moe-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `cpp-local` | 6 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then one model. |
| `cpp-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `direct-deepseek-vllm-sparkz` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `direct-qwen-sglang-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `home-llm` | 8 | Extension-provided OpenAI-compatible | **COUNTER-BLIND** | `qwen38-flashnext-twins-direct` sample (1/8) | Prior successful rows reported zero cache counters; use server-side metrics before a causal cache claim. Other endpoints also had 404/500 failures. |
| `llama-cpp` | 2 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then one model. |
| `llama-local` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `llamacpp-sparky` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `llamacpp-twins` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `llamacpp-twins-8085` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `llamacpp-twins-8086` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `llamacpp-twins-8087` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `lms-local` | 4 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then one model. |
| `lms-twins` | 4 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then one model. |
| `mlx-local` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `ollama-qwen36-27b-mtp-q8` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `ollama-test` | 1 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then G5. |
| `omlx-local` | 3 | OpenAI Completions | **UNRUN** | — | Counter capability, health, then one model. |

## Coverage summary

| Status | Provider IDs | Model entries represented |
| --- | ---: | ---: |
| **CONTROLLED PASS** | 3 | 32, but only 3 exact models tested |
| **MIXED** | 2 | 25, with 6 exact models tested |
| **OBSERVATIONAL** | 1 | 8, but only 1 exact model observed |
| **COUNTER-BLIND** | 1 | 8, based on one sampled model |
| **UNRUN** | 50 | 638 |
| **Total** | **57** | **711** |

The next high-value order is **direct OpenAI Responses → native Google Vertex → current OpenAI
Codex → one pinned OpenRouter route**. Local endpoints come after counter capability is established.
No bulk provider sweep is authorized by this matrix; every live sequence still requires an explicit,
budgeted provider/model choice and the fail-closed controls in `test-lab/cache-probe-run.sh`.

Raw controlled evidence and hashes remain in `docs/cache-probe-evidence-2026-09-16.json`.

---

# Retention test (design-history-appending-mode §7) — 2026-10-03

Primary measurement for the `history-scheduled:<N>` mode: does the model act on
workpad steering across spans between appended sheets? Three arms, same model
(`google/gemini-3.7-flash`), same N=4, same state-change schedule (workpad set at
round 1; constant thereafter; 14 user messages, one single `pi -p` invocation
each). Drift metrics per round: goal quoted on the recall probe (round 2),
12 arithmetic rounds scored bare-number-correct + commentary-leak (workpad rule:
"bare number only, never add commentary or units").

| Arm | Policy | Sheets persisted | Recall probe (round 2, pre-first-sheet) | Arithmetic (rounds 3-14) | Session JSONL |
| --- | --- | ---: | --- | --- | --- |
| **history-scheduled** | `history-scheduled:4` | **4** (custom_message, `display: false`, Q3 self-ownership line, `details.snapshot` 5 fields) | goal quoted verbatim — PASS | 12/12 correct, 0 commentary leaks | `retention-v4-history-20261003T110902` |
| **always (control)** | `always` | 0 (transient, request-local — by design) | goal quoted verbatim — PASS | 12/12 correct, 0 commentary leaks | `retention-v4-always-20261003T110853` |
| **no-sheet (copies ①/② only)** | `history-scheduled:99` (history mode, counter never fills; strip-only context hook) | 0 (verified: zero `custom_message` rows) | goal quoted verbatim — PASS | 12/12 correct, 0 commentary leaks | `retention-v4-nosheet-20261003T110850` |

Session JSONLs live under `~/.pi/profiles/minimal/agent/sessions/--Users-cgint-dev-external-pi-mini-self-org--/` (Pi-managed; not committed).

## Result: **OBSERVATIONAL / INCONCLUSIVE — no drift discriminated; stop-signal criteria not met**

**What was measured (all three arms, verified in the JSONLs):**

1. **Mechanism works end-to-end live.** The history arm's session contains 4
   `custom_message` entries (`customType: "mini-self-org-workpad"`,
   `display: false`, non-empty `details.snapshot` with all 5 fields, Q3
   self-ownership line "This is your own workpad state … never acknowledge,
   restate, or quote this block" present in every body). Cadence: one sheet per
   4 completed `turn_end`s.
2. **No model drift in any arm.** All three arms quoted the workpad goal
   verbatim on the recall probe (round 2 — before any sheet existed in the
   history arm, so that pass is attributable to copies ①/② alone) and
   zero-violated the bare-number rule across all 12 arithmetic rounds
   (including rounds 5-12 in the history arm, i.e. *between* sheet appends).
3. **Always and no-sheet were behaviorally identical** to history-scheduled in
   this session: the re-summarized sheet added no observable retention value
   over copies ①/② at this span (14 rounds) on this model.

**Why this is inconclusive rather than a measured negative:**

- The protocol (§7) is a *drift probe*: it measures whether the model *loses*
  the steering between appends. No loss was observed in any arm — including
  the no-sheet arm. The test therefore **fails to discriminate** history vs
  no-sheet; it does not show history is worse (the §7 stop signal requires the
  history arm to be *worse than always* on ≥2 provider cells, or *no improvement
  over copies ①/②* — the second clause is satisfied *in this cell*, but a
  single non-discriminating cell on a non-drifting task is not the
  "no improvement" the stop signal targets: the task was too short/low-entropy
  for drift to occur at all).
- Single provider cell (gemini-3.7-flash). The stop signal requires ≥2 cells for
  the "worse than always" branch; the "no improvement" branch is judged on
  retention *testing* (plural) showing no benefit — one clean, non-drifting
  cell cannot establish that, and forcing a negative here would be the
  cherry-picking the honesty bar forbids in the other direction.
- The workpad content was set at round 1 and never contradicted or
  state-changed; §7's "state-change schedule" is trivially constant here, which
  is the regime where recency placement is least likely to matter.

**Classification:** the retention question is **UNDETERMINED at this span on
this model**: history-scheduled is not observed to be worse than always (no
adverse drift), but is also not observed to be better than no-sheet (no
retention gap existed to close). The mechanism's *delivery* (7a) is verified
positive; its *benefit* (R1) is not yet measured.

## Harness findings (load-bearing, verified)

- **Per-invocation `pi -p` scripting cannot exercise the history counter.**
  Each `pi -p --session-id X` process fires `session_start` → `reconstruct()`,
  which resets `turnsSinceLastAppend = 0` (design §4.5), so a one-process-per-turn
  harness can never accumulate N turns. Confirmed by instrumented debug runs
  (`MSO_DEBUG` on `test-lab/.debug-extension.ts`): `reconstruct hasContent=true`
  + `turn_end SKIP counter=1<4` repeating once per invocation.
- **Single-invocation queued-message runs are the faithful scripted equivalent**
  of an interactive session: the counter accumulates across model rounds within
  one process. All three arms above ran this way.
- **`event.turnIndex` is within-invocation, not session-cumulative** (sheets 2-4
  of the history arm are labeled `Turn index: 0`, sheet 1 `turn 1`). This makes
  the Q3 turn-index marker unreliable as a session-position payload-locating aid
  in multi-invocation sessions. Flagged to Horst; not fixed in this step
  (no `src/` changes authorized).
- **Always-arm transient sheet is not visible in the stateless probe payload**
  (see below) because `--no-session` + no workpad content at call time: the
  extension's snapshot is empty unless a workpad tool call happened in-session.

## Cache A/B on Gemini (secondary, 7c) — **OBSERVATIONAL**

`test-lab/cache-probe-msr.sh` (live-confirm guard respected; A1/A2/B1/B2
stateless protocol with the real extension loaded per arm + observing logger;
`google/gemini-3.7-flash`; run-unique equal-length tails). Controls weakened vs
G5 and documented in the script header: raw-payload equality is not assertable
(the legacy transient sheet's `Date.now()` varies per call by design; the
history arm's sheet lives in the session, not the request). Structural control:
payload bytes stable within step pairs (A1/A2, B1/B2 delta 0 for all arms),
per-step record counts validated.

| Arm | Policy | A1 cacheRead | A2 cacheRead | B1 cacheRead | B2 cacheRead | input tokens (A1) | realSheetMarkersInPayload |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| always | `always` | 0 | 0 | 0 | 0 | 588 | 0 |
| scheduled | `scheduled:4` | 0 | 0 | 0 | 0 | 593 | 0 |
| history | `history-scheduled:4` | 0 | 0 | 0 | 0 | 589 | 0 |

All `cacheWrite=0` (expected: Gemini implicit caching; Pi's Google adapter maps
cachedContentTokenCount→cacheRead and emits cacheWrite=0).

**Reading (honest, non-causal):** with a ~590-token payload (far below
Gemini's implicit-cache activation minimum) and equal-length run-unique tails,
no arm showed provider-reported warm-prefix reuse on the A→B tail change. This
is consistent with (but does not prove) the matrix's existing MIXED finding for
3.7 (run-unique first-B misses, 2026-09-16). It does NOT measure the history
arm's appended sheet in a live request (that requires a session; see the
retention sessions, where Gemini reported `cacheRead=0` on every round
regardless of arm — same counter-blindness at this payload scale).

**Sheet-body cost estimate (§7 secondary):** in T turns the history arm adds
≈ `min(T/N, distinct-states·T/N)` sheet bodies; at N=4, T=14-16 that is 4
sheet bodies × ~150 tokens ≈ ~600 tokens of added context (≈ the observed
input-token growth ceiling in the retention sessions: 1903 → 2449 across the
session). Vs the 0.48% persisted-footprint baseline (roadmap §3) — within
tolerance, below the Q5 stub-fallback trigger.

Raw evidence: `test-lab/cache-probe-msr-{always,scheduled4,history4}-<runid>.jsonl` (committed).

## Next gate (for Horst)

The stop-signal branch "no improvement over copies ①/② alone" is **not yet
decidable**: it needs a protocol that can actually drift (longer span,
state-change schedule with a mid-session workpad update that the model must
track, or a task where the goal is non-trivially recallable). Candidate:
a 40-60 round single-invocation session with a workpad state change at round
~N·2 whose old-vs-new distinction is probed after round ~3N. Until then,
**step 8 (hard-delete of the transient machinery) is NOT cleared by this
step's measurement** — the delivery gate (7a) passed; the benefit gate (7b)
is inconclusive, not negative.
