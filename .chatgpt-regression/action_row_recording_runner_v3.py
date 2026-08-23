#!/usr/bin/env python3
"""Dismiss the Workspaces coachmark, then run the PR 93877 recording suite."""

from __future__ import annotations

import importlib.util
import re
import sys
import time
from pathlib import Path

BASE = Path(__file__).with_name("action_row_recording_runner_v2.py")
spec = importlib.util.spec_from_file_location("action_row_recording_v2", BASE)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {BASE}")
suite = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = suite
spec.loader.exec_module(suite)


def bounds_area(node: dict[str, str]) -> int:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    if not match:
        return 1 << 62
    left, top, right, bottom = (int(value) for value in match.groups())
    return max(0, right - left) * max(0, bottom - top)


original_dismiss_blocking_dialog = suite.dismiss_blocking_dialog


def dismiss_blocking_dialog(nodes: list[dict[str, str]]) -> str | None:
    texts = "\n".join(suite.app.node_text(node) for node in nodes).casefold()
    if "new to concierge ai" in texts or "interactive spend analysis" in texts:
        close_nodes = suite.runner.exact_nodes(nodes, ["Close"])
        close_nodes = [node for node in close_nodes if bounds_area(node) < 300_000]
        close_nodes.sort(key=bounds_area)
        if close_nodes and suite.tap_node(close_nodes[0]):
            return "Close coachmark"
    return original_dismiss_blocking_dialog(nodes)


suite.dismiss_blocking_dialog = dismiss_blocking_dialog


def clear_overlays(label: str, attempts: int = 8) -> list[str]:
    dismissed: list[str] = []
    time.sleep(4)
    for attempt in range(attempts):
        nodes = suite.app.parse_nodes(suite.app.dump_xml(f"{label}-overlay-{attempt}"))
        blocker = dismiss_blocking_dialog(nodes)
        if not blocker:
            break
        dismissed.append(blocker)
    if dismissed:
        suite.app.RESULTS.setdefault("dismissed_blockers", []).extend(dismissed)
    return dismissed


original_open_workspaces = suite.runner.open_workspaces


def open_workspaces(package: str, activity: str) -> bool:
    opened = original_open_workspaces(package, activity)
    if opened:
        clear_overlays("workspaces")
    return opened


original_open_categories = suite.runner.open_categories


def open_categories(package: str, activity: str) -> bool:
    opened = original_open_categories(package, activity)
    if opened:
        clear_overlays("categories")
    return opened


suite.runner.open_workspaces = open_workspaces
suite.runner.open_categories = open_categories
sys.exit(suite.main())
