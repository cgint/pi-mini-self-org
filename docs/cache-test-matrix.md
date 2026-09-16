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
