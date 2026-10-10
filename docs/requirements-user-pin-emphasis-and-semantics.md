# Requirements: User-Pinned Guardrail Emphasis & Semantic Clarity

**Status:** Draft / Ready for Alignment  
**Audience:** User, Product, Sub-Agent Implementation Team  
**Scope:** Functional and behavioral requirements from a user experience and steering perspective (no implementation code).

---

## 1. Problem Statement & User Experience Friction

Currently, users can pin a standing instruction to guide the AI during long sessions. However, two primary frictions prevent it from working effectively:

1. **Visual Invisibility (The "Drowning" Effect):**  
   In both terminal notifications and the injected steering display, the pinned user text is visually indistinguishable from the agent's multi-field scratchpad. Because the agent's scratchpad is bulky (multiple sections, bullet points, progress notes), the short user instruction is easily missed. Users feel compelled to type in **ALL CAPS** (e.g., `KEEP BACKWARD COMPATIBILITY`) just to give it visual contrast.

2. **Semantic Ambiguity for the AI:**  
   Labeling the text as an abstract `USER DIRECTIVE` communicates *what* the container is, but not *what it means* or *how the AI must behave*. The AI often interprets it as a passive note, an optional hint, or just another equal item alongside its own self-defined goals, rather than an inviolable boundary.

---

## 2. Core Non-Technical Requirements

### REQ-1: Natural Input Without Artificial Formatting
- The user must **never** be forced to shout in ALL CAPS, insert emoji warnings (e.g., `⚠️`), or manually add decorative borders to ensure their instruction is noticed.
- Normal sentence case (e.g., `"keep all changes backwards compatible"`) must receive sufficient system emphasis by default.

### REQ-2: Unmistakable Visual Contrast (Human-Facing Views)
- Whenever the workpad is displayed to the user (via commands or notifications), the pinned user instruction must be immediately recognizable at a glance.
- It must have dedicated visual boundaries (e.g. clean borders or divider lines) separating it from the agent’s scratchpad.
- **No emoji icons:** Do not use pin icons (`📌`) or warning emojis; rely strictly on clean typographic layout, delimiters, and clear wording.
- **Viewport and Wrapping Resilience:** Visual delimiters must render cleanly without wrapping or creating jagged line breaks across common split-pane terminal sizes (including narrow splits down to ~60–80 columns).
- The visual hierarchy must make it clear that the user instruction is primary and distinct from the agent's temporary working notes.

### REQ-3: Unambiguous Operational Semantics (AI-Facing Steering)
- The prompt presentation must explicitly communicate to the AI:
  1. **Source & Authority:** This comes directly from the human and cannot be negotiated or altered by the AI.
  2. **Priority Hierarchy:** This is a supreme constraint. It strictly bounds and overrides all AI-generated goals, tasks, plans, and actions.
  3. **Behavioral Invariant:** The AI must never compromise or violate this rule in pursuit of any other task.
  4. **Silent Adherence (Anti-Echo):** Strong emphasis must not provoke conversational chatter; the AI must adhere to the rule silently during execution rather than acknowledging, repeating, or reciting it. This governs the **AI's conversational output only**. It does NOT constrain the human-facing TUI status-line blip: the `self-org-workpad-set` steering notice (`docs/feature-impl/20260717-compass-notice/`) intentionally re-blips on the injection cadence to inform the *human* that the guardrail is in the agent's head — that is a `ui.notify` side effect, invisible to the AI and does not make the AI recite the rule.
- The terminology used must be plain and direct (e.g., a "Standing Guardrail" or "Non-Negotiable User Constraint") rather than generic technical jargon like "directive".

### REQ-4: Clear Boundary Between Human Rules and Agent Scratchpad
- The presentation must maintain a clean structural separation:
  - **Human Zone:** The immutable, high-priority standing rule.
  - **Agent Zone:** The flexible, tactical scratchpad (goals, focus, next steps, notes).
- The presence of the user rule must not break or confuse the agent’s ability to manage its own tactical fields.

---

## 3. Acceptance Criteria (How We Know It's Right)

### AC-1: Legibility Without ALL CAPS
- **Given** a user pins a rule in standard lowercase text (e.g., `do not modify production database scripts`),  
- **When** the workpad is displayed in the terminal,  
- **Then** the user rule immediately draws the eye before the agent's scratchpad, with clear visual separation that eliminates any urge to re-type in uppercase.

### AC-2: AI Adherence and Respect of Precedence
- **Given** an active pinned user guardrail and conflicting tactical tasks or agent-chosen shortcuts,  
- **When** the AI plans next actions or evaluates code choices,  
- **Then** the AI treats the human guardrail as a hard invariant that overrides any conflicting goal.
- **And** the AI adheres silently without verbose conversational acknowledgements (e.g., does not prepend responses with "Understood, I will follow the guardrail").

### AC-3: Clean Fallback When Empty
- **Given** no user rule has been pinned,  
- **When** the workpad is displayed,  
- **Then** no empty user guardrail placeholders or awkward empty boxes clutter the display; the agent scratchpad renders cleanly.

### AC-4: Resilient to Complex Multiline Rules & Viewport Widths
- **Given** a user inputs a 2–3 line standing constraint within the character limit,  
- **When** it is displayed in standard or narrow split terminals (down to 60 columns),  
- **Then** the entire message is preserved within the emphatic visual boundary without line wrapping artifacts, truncation, or broken borders.
