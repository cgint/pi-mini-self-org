#!/usr/bin/env python3
"""Regression checks for exact workpad-write call counting in tic-metrics."""
import importlib.util
import json
import tempfile
from pathlib import Path

METRICS_PATH = Path(__file__).with_name("tic-metrics.py")
spec = importlib.util.spec_from_file_location("tic_metrics", METRICS_PATH)
metrics = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(metrics)


def assistant_call(name):
    return {
        "type": "message",
        "message": {
            "role": "assistant",
            "content": [{"type": "toolCall", "name": name}],
        },
    }


entries = [
    assistant_call("self-org-workpad-set"),
    assistant_call("mini-self-org-workpad"),
    assistant_call("workpad"),
    assistant_call("self-org-workpad-get"),
    assistant_call("self-org-workpad-history"),
    assistant_call("mini-self-org-workpad-get"),
    assistant_call("mini-self-org-history"),
    {
        "type": "message",
        "message": {"role": "user", "content": [{"type": "toolCall", "name": "mini-self-org-workpad"}]},
    },
]

with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl") as session:
    session.write("\n".join(json.dumps(entry) for entry in entries))
    session.write("\n")
    session.flush()
    _, workpad_calls = metrics.assistant_texts(session.name)

assert workpad_calls == 3, workpad_calls
print("tic-metrics workpad write-call regression: PASS")
