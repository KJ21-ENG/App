#!/usr/bin/env python3
"""Record the PR 93877 mobile action-row behavior on an Android emulator."""

from __future__ import annotations

import importlib.util
import json
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Iterable

HARNESS = Path(__file__).with_name("seeded_table_regression.py")
spec = importlib.util.spec_from_file_location("seeded_table_regression", HARNESS)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {HARNESS}")
app = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = app
spec.loader.exec_module(app)


def pull_database(stage: str, package: str) -> None:
    for suffix in ("", "-wal", "-shm"):
        app.adb(
            "pull",
            f"/data/user/0/{package}/files/OnyxDB{suffix}",
            str(app.EVIDENCE / f"OnyxDB-{stage}{suffix}"),
            check=False,
            timeout=60,
        )


def fixed_shell(command: str, *, check: bool = True, timeout: int | float | None = 120):
    package_match = re.search(r"/data/user/0/([^/]+)/files/OnyxDB", command)
    package = package_match.group(1) if package_match else None
    if "cp /data/local/tmp/OnyxDB.seed" in command:
        directory_match = re.search(r"cp /data/local/tmp/OnyxDB\.seed (/data/user/0/[^/]+/files)/OnyxDB", command)
        owner_match = re.search(r"chown (\d+:\d+) /data/user/0/[^/]+/files/OnyxDB", command)
        if directory_match and owner_match:
            files_dir = directory_match.group(1)
            owner = owner_match.group(1)
            command = f"mkdir -p {files_dir} && chown {owner} {files_dir} && chmod 700 {files_dir} && {command}"
    result = app.adb("shell", command, check=check, timeout=timeout)
    if package and "stat -c" in command and "OnyxDB*" not in command:
        pull_database("seeded", package)
    return result


def seed_olddot_identity(package: str) -> None:
    uid = int(app.RESULTS["app_uid"])
    app_dir = f"/data/user/0/{package}"
    state = {
        "isOnStaging": True,
        "offline": True,
        "lastAuthenticated": int(time.time() * 1000),
        "ssoType": "SAML",
        "lastUsedEmail": app.LOGIN,
        "history": [],
        "pageExtrasHistory": [],
        "accountInfo": {
            "email": app.LOGIN,
            "authToken": "offline-regression-auth-token",
            "encryptedAuthToken": "offline-regression-auth-token",
            "accountID": app.ACCOUNT_ID,
            "hasSetPassword": False,
        },
        "scanReceipt": True,
        "pages": {},
        "queued": [],
        "appUserEmail": app.LOGIN,
        "deviceLoginID": "expensify.cash-offline-regression",
        "nameValuePairs": {
            "tryNewDot": {
                "classicRedirect": {
                    "dismissed": True,
                    "timestamp": "2026-08-22T00:00:00.000Z",
                }
            }
        },
        "personalPolicyID": "personal",
        "currentPolicyID": "personal",
    }
    local = Path("/tmp/state_v19.json")
    local.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    app.adb("push", str(local), "/data/local/tmp/state_v19.json", timeout=60)
    app.shell(
        f"mkdir -p {app_dir}/files && "
        f"rm -f {app_dir}/files/savedState.json {app_dir}/files/state_v*.json && "
        f"cp /data/local/tmp/state_v19.json {app_dir}/files/state_v19.json && "
        f"chown {uid}:{uid} {app_dir}/files/state_v19.json && "
        f"chmod 600 {app_dir}/files/state_v19.json && restorecon -RF {app_dir}/files"
    )
    app.RESULTS["olddot_state_seeded"] = True
    app.RESULTS["olddot_identity_mode"] = "synthetic_saml"


original_install_and_seed = app.install_and_seed


def install_and_seed(package: str) -> None:
    original_install_and_seed(package)
    seed_olddot_identity(package)


app.shell = fixed_shell
app.install_and_seed = install_and_seed


def exact_nodes(nodes: list[dict[str, str]], labels: Iterable[str]) -> list[dict[str, str]]:
    wanted = {label.casefold() for label in labels}
    matches = [
        node
        for node in nodes
        if wanted.intersection(
            {
                node.get("text", "").strip().casefold(),
                node.get("content-desc", "").strip().casefold(),
            }
        )
    ]
    matches.sort(key=lambda node: (node.get("clickable") != "true", node.get("focusable") != "true"))
    return matches


def tap_label(labels: str | Iterable[str], timeout: int = 20, evidence_label: str = "tap") -> bool:
    wanted = [labels] if isinstance(labels, str) else list(labels)
    deadline = time.monotonic() + timeout
    attempt = 0
    while time.monotonic() < deadline:
        nodes = app.parse_nodes(app.dump_xml(f"{evidence_label}-{attempt}"))
        matches = exact_nodes(nodes, wanted)
        if matches:
            center = app.bounds_center(matches[0].get("bounds", ""))
            if center:
                app.shell(f"input tap {center[0]} {center[1]}")
                time.sleep(2)
                return True
        attempt += 1
        time.sleep(1)
    return False


def wait_for_text(needle: str, timeout: int = 45) -> bool:
    deadline = time.monotonic() + timeout
    attempt = 0
    while time.monotonic() < deadline:
        nodes = app.parse_nodes(app.dump_xml(f"wait-{attempt}"))
        if app.contains_text(nodes, needle):
            return True
        attempt += 1
        time.sleep(2)
    return False


def dismiss_overlays() -> list[str]:
    dismissed: list[str] = []
    for attempt in range(8):
        nodes = app.parse_nodes(app.dump_xml(f"overlay-{attempt}"))
        chosen: tuple[str, dict[str, str]] | None = None
        for label in ("Dismiss", "Got it", "Maybe later", "Not now", "Close"):
            matches = exact_nodes(nodes, [label])
            if matches:
                chosen = (label, matches[0])
                break
        if not chosen:
            break
        label, node = chosen
        center = app.bounds_center(node.get("bounds", ""))
        if not center:
            break
        app.shell(f"input tap {center[0]} {center[1]}")
        dismissed.append(label)
        time.sleep(3)
    app.RESULTS["dismissed_overlays"] = dismissed
    return dismissed


def start_recording(label: str) -> tuple[subprocess.Popen[str], str, Path, Any]:
    remote = f"/sdcard/{label}.mp4"
    local = app.EVIDENCE / f"{label}.mp4"
    log_handle = (app.EVIDENCE / f"{label}-screenrecord.txt").open("w", encoding="utf-8")
    app.shell(f"rm -f {remote}", check=False)
    proc = subprocess.Popen(
        [
            str(app.ADB),
            "shell",
            "screenrecord",
            "--size",
            "720x1600",
            "--bit-rate",
            "4000000",
            "--time-limit",
            "90",
            remote,
        ],
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        text=True,
    )
    time.sleep(2)
    if proc.poll() is not None:
        log_handle.close()
        raise app.HarnessError(f"screenrecord exited before {label} interaction")
    return proc, remote, local, log_handle


def stop_recording(proc: subprocess.Popen[str], remote: str, local: Path, log_handle: Any) -> None:
    if proc.poll() is None:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            app.shell("pkill -2 screenrecord", check=False)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
    log_handle.close()
    time.sleep(3)
    app.adb("pull", remote, str(local), check=False, timeout=120)
    if not local.exists() or local.stat().st_size < 10_000:
        raise app.HarnessError(f"Recording {local.name} was not finalized")


def action_bounds(nodes: list[dict[str, str]], labels: Iterable[str]) -> str | None:
    matches = exact_nodes(nodes, labels)
    return matches[0].get("bounds") if matches else None


def visible_indices(nodes: list[dict[str, str]], prefix: str) -> list[int]:
    pattern = re.compile(re.escape(prefix) + r"\s+(\d{3})", re.IGNORECASE)
    values = {
        int(match.group(1))
        for node in nodes
        if (match := pattern.search(app.node_text(node)))
    }
    return sorted(values)


def record_scroll(scenario: str, action_labels: list[str], row_prefix: str, swipes: int) -> dict[str, Any]:
    initial_nodes = app.capture(f"{scenario}-initial")
    initial_action = action_bounds(initial_nodes, action_labels)
    initial_rows = visible_indices(initial_nodes, row_prefix)
    proc, remote, local, log = start_recording(f"{scenario}-recording")
    try:
        time.sleep(2)
        app.swipe_up(swipes)
        time.sleep(3)
        scrolled_nodes = app.capture(f"{scenario}-scrolled")
        time.sleep(2)
    finally:
        stop_recording(proc, remote, local, log)
    scrolled_action = action_bounds(scrolled_nodes, action_labels)
    scrolled_rows = visible_indices(scrolled_nodes, row_prefix)
    result = {
        "initial_action_bounds": initial_action,
        "scrolled_action_bounds": scrolled_action,
        "initial_visible_rows": initial_rows,
        "scrolled_visible_rows": scrolled_rows,
        "rows_advanced": bool(scrolled_rows and (not initial_rows or max(scrolled_rows) > max(initial_rows))),
        "action_fixed": bool(initial_action and scrolled_action and initial_action == scrolled_action),
        "action_moved": bool(initial_action and (not scrolled_action or initial_action != scrolled_action)),
        "recording": local.name,
        "recording_bytes": local.stat().st_size,
    }
    app.RESULTS["checks"][scenario] = result
    return result


def scroll_to_top() -> None:
    size = app.shell("wm size").stdout
    match = re.search(r"Override size: (\d+)x(\d+)", size) or re.search(r"Physical size: (\d+)x(\d+)", size)
    width, height = (1080, 2400) if not match else (int(match.group(1)), int(match.group(2)))
    for _ in range(8):
        app.shell(f"input swipe {width // 2} {int(height * 0.22)} {width // 2} {int(height * 0.88)} 500")
        time.sleep(0.5)


def open_workspaces(package: str, activity: str) -> bool:
    if tap_label("Workspaces", 20, "workspaces-tab") and wait_for_text("Regression Workspace 001", 40):
        return True
    app.launch_uri(package, activity, "new-expensify://workspaces", "workspaces-deeplink")
    dismiss_overlays()
    return wait_for_text("Regression Workspace 001", 45)


def open_categories(package: str, activity: str) -> bool:
    scroll_to_top()
    if tap_label("Regression Workspace 001", 15, "workspace-001"):
        if wait_for_text("Categories", 30) and tap_label("Categories", 15, "categories-menu"):
            if wait_for_text("Regression Category 001", 45):
                return True
    app.launch_uri(package, activity, f"new-expensify://workspaces/{app.POLICY_ID}/categories", "categories-deeplink")
    dismiss_overlays()
    return wait_for_text("Regression Category 001", 45)


def capture_failure(package: str, reason: str) -> None:
    app.write_text(app.EVIDENCE / "harness-exception.txt", reason + "\n")
    app.capture("failure-diagnostic")
    pull_database("failure", package)


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

        launched = app.shell(f"monkey -p {package} -c android.intent.category.LAUNCHER 1", check=False, timeout=60)
        app.write_text(app.EVIDENCE / "00-launch.txt", launched.stdout + launched.stderr)
        if not wait_for_text("Workspaces", 60):
            raise app.HarnessError("Authenticated Home did not expose the Workspaces navigation tab")
        dismiss_overlays()
        app.capture("00-home-ready")

        if not open_workspaces(package, activity):
            raise app.HarnessError("Seeded policies were not visible on Workspaces")
        workspace_nodes = app.capture("10-workspaces-ready")
        if not app.record_screen_check("workspaces_ready", workspace_nodes, ["Workspaces", "Regression Workspace 001"]):
            raise app.HarnessError("Workspaces page did not render the expected seeded row")

        workspace = record_scroll("11-workspaces-mobile", ["New"], "Regression Workspace", 4)
        workspaces_pass = workspace["rows_advanced"] and workspace["action_moved"]
        app.RESULTS["checks"]["workspaces_action_scrolls_with_list"] = workspaces_pass
        ok &= workspaces_pass

        if not open_categories(package, activity):
            raise app.HarnessError("Could not open populated Categories table")
        category_nodes = app.capture("20-categories-ready")
        if not app.record_screen_check("categories_ready", category_nodes, ["Categories", "Regression Category 001"]):
            raise app.HarnessError("Categories page did not render the expected seeded row")

        categories = record_scroll(
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
            capture_failure(package, reason)
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
        app.write_text(app.EVIDENCE / "executed-action-row-recording-runner.py", Path(__file__).read_text(encoding="utf-8"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
