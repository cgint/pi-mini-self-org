#!/usr/bin/env bash
# Re-derive every copied string in g1-fixture.ts from git and fail on drift.
#
# The fixture must match shipped text everywhere it is NOT the independent variable. Its texts
# were transcribed by hand from git output, so this check is what makes that claim real rather than
# aspirational. Compares: guidance constants, both tool descriptions, the two injected block
# templates (NEW from 8ab3870, OLD from 8ab3870^), and the private formatFields/hasContent bodies.
#
# Run: test-lab/drift-check.sh   (exit 0 = fixture matches shipped text)
set -uo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PYEOF'
import subprocess, sys, re

def show(rev):
    return subprocess.run(["git", "show", f"{rev}:src/mini-self-org.ts"],
                          capture_output=True, text=True, check=True).stdout

def lits(text):
    """Single-line double-quoted string constants: name -> literal body."""
    return {m.group(1): m.group(2)
            for m in re.finditer(r'^const ([A-Z_]+) = "((?:[^"\\]|\\.)*)";$', text, re.M)}

def tmpl(text, anchor):
    """Template literal body (inside backticks) starting at/after `anchor`."""
    i = text.find(anchor)
    if i < 0: return None
    a = text.find("`", i)
    if a < 0: return None
    b = text.find("`", a + 1)
    return None if b < 0 else text[a + 1:b]

def braces(t, k):
    """Balanced { ... } body starting at/after index k, whitespace-normalised."""
    s = t.find("{", k)
    if s < 0: return None
    d = 0
    for p in range(s, len(t)):
        if t[p] == "{": d += 1
        elif t[p] == "}":
            d -= 1
            if d == 0: return " ".join(t[s:p + 1].split())
    return None

new_src, old_src, head_src = show("8ab3870"), show("8ab3870^"), show("HEAD")
fx = open("test-lab/g1-fixture.ts", encoding="utf-8").read()
fails = []

# src is the shipped baseline. If it moved since the framing fix, the NEW arm's texts are stale.
if head_src != new_src:
    fails.append("src/mini-self-org.ts changed since 8ab3870 — re-derive NEW arm texts from HEAD")

CONSTS = ["TOOL_NAME_GUIDANCE", "LIST_GUIDANCE", "EVIDENCE_TAG_GUIDANCE",
          "NOTES_SEMANTICS", "DURABILITY_GUIDANCE", "RECALL_GUIDANCE"]
cn, cf = lits(new_src), lits(fx)
for k in CONSTS:
    if k not in cn: fails.append(f"{k}: not a single-line literal in src (extractor anchor stale)")
    elif k not in cf: fails.append(f"{k}: missing from fixture")
    elif cn[k] != cf[k]: fails.append(f"{k}: fixture literal differs from src")

a, b = tmpl(new_src, "const STALE_STATE_GUIDANCE ="), tmpl(fx, "const STALE_STATE_GUIDANCE =")
if a is None or b is None:
    fails.append(f"STALE_STATE_GUIDANCE: template not found (src={a is not None}, fixture={b is not None})")
elif a != b: fails.append("STALE_STATE_GUIDANCE: fixture template differs from src")

# Tool descriptions: src inlines them in registerTool; the fixture hoists them to constants.
for label, a_src, a_fx in (("workpad description", "description: `Your own scratchpad", "const WORKPAD_DESCRIPTION ="),
                           ("history description", "description: `Read the session-local focus history", "const HISTORY_DESCRIPTION =")):
    x, y = tmpl(new_src, a_src), tmpl(fx, a_fx)
    if x is None: fails.append(f"{label}: not found in src (extractor anchor stale)")
    elif y is None: fails.append(f"{label}: not found in fixture")
    elif x != y:
        i = next((j for j in range(min(len(x), len(y)) + 1) if x[:j] != y[:j]), 0)
        fails.append(f"{label}: diverges at char {i}\n    src: {x[max(0,i-40):i+60]!r}\n    fix: {y[max(0,i-40):i+60]!r}")

# Injected block templates: the independent variable. Each must match its historical source.
b_new = (tmpl(new_src, "function contextMessage"), tmpl(fx, "function blockNew"))
b_old = (tmpl(old_src, "function contextMessage"), tmpl(fx, "function blockOld"))
for label, (x, y) in (("blockNew vs 8ab3870 contextMessage", b_new),
                      ("blockOld vs 8ab3870^ contextMessage", b_old)):
    if x is None: fails.append(f"{label}: src template not found (extractor anchor stale)")
    elif y is None: fails.append(f"{label}: fixture template not found")
    elif x != y: fails.append(f"{label}: diverges\n    src: {x!r}\n    fix: {y!r}")

# If OLD and NEW collapsed to the same text, the arms would not be testing wording at all.
if b_new[1] is not None and b_new[1] == b_old[1]:
    fails.append("blockOld == blockNew: the OLD and NEW arms would be identical")

for label, anchor in (("formatFields", "function formatFields"), ("hasContent", "function hasContent")):
    i, j = new_src.find(anchor), fx.find(anchor)
    if i < 0 or j < 0:
        fails.append(f"{label}: not found (src={i>=0}, fixture={j>=0})"); continue
    x, y = braces(new_src, i), braces(fx, j)
    if x != y: fails.append(f"{label}: fixture body differs from src\n    src: {x}\n    fix: {y}")

if fails:
    print("DRIFT — fixture no longer matches shipped text:")
    for f in fails: print("  -", f)
    sys.exit(1)
print("drift check OK: fixture matches shipped text; blockOld and blockNew differ as intended")
PYEOF
