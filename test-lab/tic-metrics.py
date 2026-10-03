#!/usr/bin/env python3
"""tic-metrics — parse G1 debug dumps + session files into per-arm metrics.

Usage:
  tic-metrics.py DUMP.jsonl SESSION.jsonl [MORE pairs in same order interleaved]

Pairs are (dump, session) for one arm. Pass 'dump|-' or '-|-' to skip one side.
Output: one JSON object per arm to stdout (pretty), plus --verbose per-request rows.

Metrics per arm:
  requests            LLM requests recorded in the dump
  pushed_sheets       requests that carried an injected sheet block
  sheet_bytes         [min, max] of pushed blockBytes
  mb_first_mb_last    messagesBefore bookends (continuation evidence)
  workpad_calls       write tool calls named self-org-workpad-set, mini-self-org-workpad, or workpad in the session
  assistant_text_blocks  text blocks in assistant messages
  tic_turns           assistant turns containing >=1 tic marker
  tic_counts          per-marker occurrences across all assistant text
  tic_rate            tic_turns / assistant_text_blocks

Tic markers: exact preamble echoes (strongest evidence of the tic) plus the
generic self-reference words, counted separately so strong/weak stay visible.
"""
import json
import re
import sys

STRONG = [
    "not a message from the user",
    "Do not restate or acknowledge it",
    "Re-derive facts from the conversation",
    "steering state for this session",
    "working scratchpad",
    "sheet of paper",
]
WEAK = ["workpad", "scratchpad", "mini-self-org"]
WORKPAD_WRITE_TOOL_NAMES = {
    "self-org-workpad-set",
    "mini-self-org-workpad",
    "workpad",
}


def parse_dump(path):
    rows = []
    if path in (None, "-", ""):
        return rows
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def assistant_texts(session_path):
    """Yield (text, has_workpad_call) per turn-level assistant contribution."""
    if session_path in (None, "-", ""):
        return [], 0
    workpad_calls = 0
    turns = []  # (text_of_last_assistant_msg_before_next_user, was_workpad_call)
    pending_text_parts = []
    pending_workpad = False
    for line in open(session_path):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("type") != "message":
            continue
        msg = entry.get("message") or {}
        role = msg.get("role")
        content = msg.get("content")
        if role == "user":
            if pending_text_parts or pending_workpad:
                turns.append((" ".join(pending_text_parts), pending_workpad))
            pending_text_parts, pending_workpad = [], False
            continue
        if role != "assistant" or not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "text":
                pending_text_parts.append(block.get("text", ""))
            elif btype in ("toolCall", "tool_use", "functionCall"):
                name = (
                    block.get("name")
                    or (block.get("function") or {}).get("name")
                    or ""
                )
                if name in WORKPAD_WRITE_TOOL_NAMES:
                    pending_workpad = True
                    workpad_calls += 1
    if pending_text_parts or pending_workpad:
        turns.append((" ".join(pending_text_parts), pending_workpad))
    return turns.strip() if isinstance(turns, str) else turns, workpad_calls


def analyze(dump_path, session_path, label):
    rows = parse_dump(dump_path)
    turns, workpad_calls = assistant_texts(session_path)
    texts = [t for t, _ in turns if t.strip()]
    counts = {m: 0 for m in STRONG + WEAK}
    tic_turns = 0
    for text in texts:
        low = text.lower()
        hit = False
        for m in STRONG + WEAK:
            n = len(re.findall(re.escape(m), low))
            if n:
                counts[m] += n
                hit = True
        # a turn counts as a tic turn only on a STRONG marker or any weak hit
        if hit:
            tic_turns += 1
    pushed = [r for r in rows if r.get("pushed")]
    mbs = [r.get("messagesBefore") for r in rows if r.get("messagesBefore") is not None]
    result = {
        "arm": label,
        "requests": len(rows),
        "pushed_sheets": len(pushed),
        "sheet_bytes": (
            [min(r["blockBytes"] for r in pushed), max(r["blockBytes"] for r in pushed)]
            if pushed
            else None
        ),
        "mb_first_mb_last": [mbs[0], mbs[-1]] if mbs else None,
        "workpad_calls": workpad_calls,
        "assistant_text_blocks": len(texts),
        "tic_turns": tic_turns,
        "tic_counts": counts,
        "tic_rate": round(tic_turns / len(texts), 4) if texts else None,
    }
    return result, rows


def main():
    args = sys.argv[1:]
    verbose = False
    if "--verbose" in args:
        verbose = True
        args = [a for a in args if a != "--verbose"]
    if len(args) % 2 != 0:
        sys.exit("usage: tic-metrics.py [--verbose] DUMP|- SESSION|- [DUMP|- SESSION|- ...]")
    out = []
    for i in range(0, len(args), 2):
        label = args[i].rsplit("/", 1)[-1].replace(".jsonl", "") or args[i + 1]
        result, rows = analyze(args[i], args[i + 1], label)
        out.append(result)
    print(json.dumps(out, indent=2))
    if verbose:
        for r in out:
            pass
    # verbose rows: re-parse per arm
    if verbose:
        for i in range(0, len(args), 2):
            rows = parse_dump(args[i])
            label = args[i].rsplit("/", 1)[-1].replace(".jsonl", "") or args[i + 1]
            print(f"--- {label}: per-request ---")
            for n, r in enumerate(rows):
                print(
                    f"  req{n:02d} mb={r.get('messagesBefore')} "
                    f"pushed={r.get('pushed')} bytes={r.get('blockBytes')}"
                )


if __name__ == "__main__":
    main()