#!/usr/bin/env python3
"""Enter NewDot through the hybrid URI, then record PR 93877 action rows."""

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).with_name("action_row_recording_runner.py")
spec = importlib.util.spec_from_file_location("action_row_recording_base", BASE)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {BASE}")
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
spec.loader.exec_module(runner)
app = runner.app


def main() -> int:
    process: subprocess.Popen[str] | None = None
    package = ""
    ok = True
    try:
        process = app.boot_emulator()
        package, activity = app.apk_identifiers()
        app.RESULTS["package"] = package
        app.RESULTS["activity"] = activity
        app.write_text(app.EVIDENCE / "app-identifiers.txt", f"package={package}\nactivity={activity}\n")
        app.install_and_seed(package)
        app.adb("logcat", "-c", check=False)
        app.set_display(1080, 2400, 420)

        # The hybrid shell opens OldDot from the launcher. Its supported
        # expensify://open handoff initializes the seeded SAML identity and
        # mounts NewDot; the path itself is subsequently selected through the
        # visible NewDot bottom navigation.
        app.launch_uri(package, activity, "expensify://open/workspaces", "00-enter-newdot")
        if not runner.wait_for_text("Workspaces", 100):
            raise app.HarnessError("Hybrid handoff did not mount the NewDot navigation shell")
        runner.dismiss_overlays()
        app.capture("00-newdot-home-ready")

        if not runner.open_workspaces(package, activity):
            raise app.HarnessError("Seeded policies were not visible on Workspaces")
        workspace_nodes = app.capture("10-workspaces-ready")
        if not app.record_screen_check("workspaces_ready", workspace_nodes, ["Workspaces", "Regression Workspace 001"]):
            raise app.HarnessError("Workspaces page did not render the expected seeded row")

        workspace = runner.record_scroll("11-workspaces-mobile", ["New"], "Regression Workspace", 4)
        workspaces_pass = workspace["rows_advanced"] and workspace["action_moved"]
        app.RESULTS["checks"]["workspaces_action_scrolls_with_list"] = workspaces_pass
        ok &= workspaces_pass

        if not runner.open_categories(package, activity):
            raise app.HarnessError("Could not open populated Categories table")
        category_nodes = app.capture("20-categories-ready")
        if not app.record_screen_check("categories_ready", category_nodes, ["Categories", "Regression Category 001"]):
            raise app.HarnessError("Categories page did not render the expected seeded row")

        categories = runner.record_scroll(
            "21-categories-mobile",
            ["Add category", "New category", "New"],
            "Regression Category",
            5,
        )
        reproduced = categories["rows_advanced"] and categories["action_fixed"]
        app.RESULTS["checks"]["blocking_issue_reproduced"] = reproduced
        app.RESULTS["blocking_issue_verdict"] = "reproduced" if reproduced else "not_reproduced"
        ok &= categories["rows_advanced"] and bool(categories["initial_action_bounds"])

        logcat = app.adb("logcat", "-d", "-v", "threadtime", check=False, timeout=60).stdout
        app.write_text(app.EVIDENCE / "logcat-full.txt", logcat)
        pattern = re.compile(
            r"FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|SIG(?:SEGV|ABRT)|ErrorBoundary|Unhandled|TypeError|ReferenceError|Invariant Violation",
            re.IGNORECASE,
        )
        important = "\n".join(line for line in logcat.splitlines() if pattern.search(line))
        app.write_text(app.EVIDENCE / "logcat-important.txt", important + ("\n" if important else ""))
        app.RESULTS["important_log_lines"] = len(important.splitlines()) if important else 0
        exit_info = app.shell(f"dumpsys activity exit-info {package}", check=False, timeout=30).stdout
        app.write_text(app.EVIDENCE / "app-exit-info.txt", exit_info)
        no_crash = not bool(re.search(r"REASON_CRASH|REASON_ANR", exit_info, re.IGNORECASE))
        no_fatal = not bool(re.search(r"FATAL EXCEPTION|SIG(?:SEGV|ABRT)|ReactNativeJS.*(?:TypeError|ReferenceError|Invariant)", important, re.IGNORECASE))
        app.RESULTS["checks"]["no_crash_exit_record"] = no_crash
        app.RESULTS["checks"]["no_js_or_native_fatal_in_logcat"] = no_fatal
        ok &= no_crash and no_fatal

    except Exception as exc:  # noqa: BLE001
        reason = f"{type(exc).__name__}: {exc}"
        app.RESULTS["harness_exception"] = reason
        if package:
            runner.capture_failure(package, reason)
        else:
            app.write_text(app.EVIDENCE / "harness-exception.txt", reason + "\n")
        ok = False
    finally:
        app.RESULTS["essential_scenarios_passed"] = ok
        app.write_text(app.EVIDENCE / "regression-summary.json", json.dumps(app.RESULTS, indent=2, sort_keys=True))
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
        app.write_text(app.EVIDENCE / "executed-action-row-recording-runner-v2.py", Path(__file__).read_text(encoding="utf-8"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
