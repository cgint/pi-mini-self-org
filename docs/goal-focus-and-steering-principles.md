# GOAL-FOCUS & Workpad Steering Principles

## 1. Core Intent & Problem Statement

In long-running, action-rich, data-intensive agent workflows, token entropy monotonically increases. As context fills with bash outputs, compilation traces, file contents, and tool results, LLMs suffer from two symmetric failure modes:
1. **Context Compaction Amnesia / Drift:** The model forgets overarching goals, boundaries, priorities, and hard limits.
2. **Steering State Pollution:** When given a workpad, the model instinctively treats it as a command log or progress ticker, dumping transient facts and debugging traces into it. This bloats context, triggers validation errors, and turns stale facts into "zombie constraints."

`pi-mini-self-org` provides an externalized executive prefrontal cortex: a constant-time, low-entropy anchor that decouples **strategic intent** from **tactical execution**.

---

## 2. Fundamental User Requirements

### R1. Absolute Separation of Storage Mediums by Lifecycle
Do not mix durable steering with volatile working data:
- **The Workpad is the Compass (Durable):** Holds only long-term and short-term goals, requirements, priorities, hard boundaries, and non-rederivable constraints. Survives context compaction.
- **Files on Disk are the Working Memory (Volatile):** Hold all command outputs, investigation traces, file lists, diffs, detailed calculations, and intermediate findings. Use a single designated working file (e.g. `findings.md`, `design.md`, or a task report) rather than littering the workspace with ad-hoc notes.
- **The Working Memory Pointer (Bridge Rule):** The compass is explicitly permitted and encouraged to retain **one durable pointer to the active working file** in `notes` or `currentFocus` (e.g. `[verified] Working memory: docs/investigation-findings.md`). This bridges the gap after context compaction so the post-compaction agent retains the location of its working memory.

### R2. Three Inclusion Gates for Workpad Content
Before adding any item to `self-org-workpad-set`, it must pass all three gates:
1. **Durability Gate:** Does it survive until the milestone is reached, or will it be stale after 5–10 tool calls?
2. **Decision Gate:** Does it materially constrain or alter the *next* consequential action batch?
3. **Derivation Asymmetry Gate:** *What is the cost to re-derive this fact?*
   - **Trivial/Low-cost re-derivation** (e.g. inspecting line number, reading 5 lines of code, running a 1-second check) → **DO NOT store in workpad.** Re-derive on demand.
   - **High-cost/Hard-won findings** (e.g. a 2-hour root cause investigation, an obscure environment requirement, a user non-negotiable) → **Store as a durable, compact `[verified]` note.**

### R3. Intent, Not Status
- **Write Intent (Durable):** State *what you aim to achieve*. Example: `"Fixing timeout in pipeline runner"` (remains valid until the fix lands).
- **Never Write Status (Volatile):** Do *not* state *where your cursor is* or *temporary progress*. Example: `"Ran test, failed at line 48, inspecting variable x"` (becomes a zombie in seconds).

### R4. Understand First Discipline
Before acting, rushing into edits, or setting tactical workpads:
- Clarify the root problem, operational boundaries, and non-negotiables.
- Anchor the high-level intent once, then do detailed investigative work in files.

---

## 3. Cognitive Failure Modes to Prevent

| Failure Mode | Definition | Prevention Rule |
|---|---|---|
| **1. Zombie Constraint** | Recording a transient failure (e.g. `"mix compile fails"`) as a blocker/note that gets fixed immediately but remains pinned across 60 turns. | Write intent, not status. Delete or overwrite stale entries at meaningful state boundaries. |
| **2. Dogmatism Anchor** | Treating hypotheses as immutable facts without epistemic labeling. | Always prefix notes with `[verified]`, `[unverified]`, or `[research]`. |
| **3. Pendulum Swing** | Over-correcting away from detail into zero-entropy, meaningless platitudes (e.g. `"Improve code"`). | State concrete boundaries and tangible outcomes with high information density per word. |
| **4. Action-Checklist Blindness** | Treating `nextActions` as an immutable script rather than 1–3 contingent hypotheses. | Keep to 1–3 coarse moves; re-evaluate when observations contradict premises. |
| **5. Stale Anchor** | Failing to update the workpad across 20+ turns after milestones are reached, causing injected context to pull the agent toward obsolete goals. | Explicitly update or clear `currentFocus` at meaningful state boundaries. |
| **6. The Orphaned Scratchpad** | Moving detailed investigation to disk but forgetting to anchor the scratchpad's path in the workpad, resulting in total amnesia of findings after compaction. | Anchor the active file path once as a `[verified]` note or focus element (The Working Memory Pointer). |

---

## 4. Workpad Field Contracts & Sizing Targets

- **`overallGoal` (<= 500 chars):** Stable umbrella outcome for the active work thread. Unchanged across tactical steps. Empty string `""` coerces to `null`.
- **`currentFocus` (<= 500 chars):** Immediate bounded strategic intent within the overall goal. Set to `null` when a step is completed before picking the next. Empty string `""` coerces to `null`.
- **`nextActions` (1–3 items typically, max 5, each <= 500 chars):** Upcoming coarse moves. Not an imperative step-by-step checklist.
- **`blockers` (0–2 items typically, max 3, each <= 500 chars):** Hard negative constraints currently preventing progress. Excludes transient command errors.
- **`notes` (1–3 items typically, max 5, each <= 500 chars):** Durable constraints, decisions, working scratchpad pointers, and high-cost epistemic findings (`[verified]`). Never a log of command output.
- **Diagnostic Feedback:** Tool rejection produces specific causal diagnostics (naming the exact field and length/item-count error) rather than opaque rejections, eliminating blind retry loops.
