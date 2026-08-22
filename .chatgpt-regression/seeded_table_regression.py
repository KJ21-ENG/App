#!/usr/bin/env python3
"""Deterministic Android UI regression harness for Expensify/App PR 93877.

The harness boots an API 35 emulator, installs the verified APK, creates an
entirely synthetic offline OnyxDB, and exercises the table pages affected by
PR 93877 without using a real account or calling Expensify APIs.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

WORKSPACE = Path(os.environ["GITHUB_WORKSPACE"])
EVIDENCE = WORKSPACE / "android-regression-evidence"
EVIDENCE.mkdir(parents=True, exist_ok=True)
ANDROID_SDK_ROOT = Path(os.environ["ANDROID_SDK_ROOT"])
EMULATOR = ANDROID_SDK_ROOT / "emulator" / "emulator"
ADB = ANDROID_SDK_ROOT / "platform-tools" / "adb"
APK = next(Path("/tmp/apk/extracted").rglob("*.apk"))
AVD_NAME = "pr93877"
LOGIN = "offline-regression@example.com"
ACCOUNT_ID = 1
POLICY_ID = "ws001"
EMPTY_POLICY_ID = "ws002"
NO_RESULT_QUERY = "ZZZNORESULT93877"

RESULTS: dict[str, Any] = {
    "pr_head": "78ef1215915a659779791df28c40111a64fd83bb",
    "apk_sha256_expected": "2b3d502fefca4ab5f79ac3b96981ab9b04c137befbc9a33f6eb89e13d78d1386",
    "checks": {},
    "notes": [],
}


class HarnessError(RuntimeError):
    pass


@dataclass
class Completed:
    stdout: str
    stderr: str
    returncode: int


def run(
    args: list[str],
    *,
    check: bool = True,
    timeout: int | float | None = 120,
    text: bool = True,
    input_text: str | None = None,
) -> Completed:
    proc = subprocess.run(
        args,
        check=False,
        timeout=timeout,
        text=text,
        input=input_text,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stdout = proc.stdout if isinstance(proc.stdout, str) else proc.stdout.decode("utf-8", "replace")
    stderr = proc.stderr if isinstance(proc.stderr, str) else proc.stderr.decode("utf-8", "replace")
    if check and proc.returncode != 0:
        raise HarnessError(f"Command failed ({proc.returncode}): {' '.join(args)}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}")
    return Completed(stdout=stdout, stderr=stderr, returncode=proc.returncode)


def adb(*args: str, check: bool = True, timeout: int | float | None = 120) -> Completed:
    return run([str(ADB), *args], check=check, timeout=timeout)


def shell(command: str, *, check: bool = True, timeout: int | float | None = 120) -> Completed:
    return adb("shell", "sh", "-c", command, check=check, timeout=timeout)


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def boot_emulator() -> subprocess.Popen[str]:
    console = (EVIDENCE / "emulator-console.txt").open("w", encoding="utf-8")
    process = subprocess.Popen(
        [
            str(EMULATOR),
            "-avd",
            AVD_NAME,
            "-no-window",
            "-noaudio",
            "-no-boot-anim",
            "-no-snapshot",
            "-wipe-data",
            "-accel",
            "on",
            "-no-metrics",
            "-gpu",
            "swiftshader_indirect",
            "-camera-back",
            "none",
            "-camera-front",
            "none",
            "-memory",
            "4096",
        ],
        stdout=console,
        stderr=subprocess.STDOUT,
        text=True,
    )
    write_text(EVIDENCE / "emulator.pid", f"{process.pid}\n")
    time.sleep(8)
    if process.poll() is not None:
        raise HarnessError((EVIDENCE / "emulator-console.txt").read_text(encoding="utf-8", errors="replace"))

    adb("wait-for-device", timeout=180)
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        if shell("getprop sys.boot_completed", check=False, timeout=10).stdout.strip() == "1":
            break
        time.sleep(2)
    else:
        raise HarnessError("Android connected through ADB but did not finish booting")

    shell("input keyevent 82", check=False)
    shell("settings put global window_animation_scale 0")
    shell("settings put global transition_animation_scale 0")
    shell("settings put global animator_duration_scale 0")
    return process


def find_aapt() -> Path:
    candidates = sorted(ANDROID_SDK_ROOT.glob("build-tools/*/aapt"))
    if not candidates:
        raise HarnessError("aapt was not found")
    return candidates[-1]


def apk_identifiers() -> tuple[str, str]:
    badging = run([str(find_aapt()), "dump", "badging", str(APK)]).stdout
    write_text(EVIDENCE / "apk-badging.txt", badging)
    package_match = re.search(r"^package: name='([^']+)'", badging, re.MULTILINE)
    activity_match = re.search(r"^launchable-activity: name='([^']+)'", badging, re.MULTILINE)
    if not package_match or not activity_match:
        raise HarnessError("Could not parse package/activity from APK")
    return package_match.group(1), activity_match.group(1)


def personal_details() -> dict[str, Any]:
    avatar = "https://d2k5nsl2zxldvw.cloudfront.net/images/avatars/avatar_7.png"
    return {
        "accountID": ACCOUNT_ID,
        "login": LOGIN,
        "avatar": avatar,
        "avatarThumbnail": avatar,
        "displayName": "Offline Regression User",
        "firstName": "Offline",
        "lastName": "Regression",
        "pronouns": "",
        "timezone": {"automatic": True, "selected": "America/New_York"},
        "phoneNumber": "",
        "localCurrencyCode": "USD",
    }


def policy(policy_id: str, index: int, *, categories: bool = False) -> dict[str, Any]:
    policy_type = "corporate" if index % 2 == 0 else "team"
    return {
        "id": policy_id,
        "name": f"Regression Workspace {index:03d}",
        "type": policy_type,
        "role": "admin",
        "ownerAccountID": ACCOUNT_ID,
        "outputCurrency": "USD",
        "created": f"2026-01-{(index % 28) + 1:02d} 12:00:00",
        "employeeList": {
            LOGIN: {
                "email": LOGIN,
                "role": "admin",
                "submitsTo": LOGIN,
            }
        },
        "areCategoriesEnabled": categories,
        "requiresCategory": False,
        "areTagsEnabled": True,
        "isPolicyExpenseChatEnabled": True,
    }


def create_seed_db(path: Path) -> None:
    if path.exists():
        path.unlink()
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=DELETE")
    conn.execute("PRAGMA synchronous=FULL")
    conn.execute(
        "CREATE TABLE keyvaluepairs (record_key TEXT NOT NULL PRIMARY KEY, valueJSON JSON NOT NULL) WITHOUT ROWID"
    )

    records: dict[str, Any] = {
        "account": {
            "validated": True,
            "isUsingExpensifyCard": False,
            "isLoading": False,
            "isFromPublicDomain": False,
            "hasAccessibleDomainPolicies": False,
            "requiresTwoFactorAuth": False,
        },
        "session": {
            "authToken": "offline-regression-auth-token",
            "encryptedAuthToken": "offline-regression-auth-token",
            "accountID": ACCOUNT_ID,
            "email": LOGIN,
            "loading": False,
        },
        "credentials": {
            "login": LOGIN,
            "autoGeneratedLogin": "expensify.cash-offline-regression",
            "autoGeneratedPassword": "offline-regression-password",
        },
        "personalDetailsList": {str(ACCOUNT_ID): personal_details()},
        "network": {"isOffline": True},
        "betas": ["all"],
        "nvp_preferredLocale": "en",
        "nvp_onboarding": {
            "hasCompletedGuidedSetupFlow": True,
            "signupQualifier": "individual",
            "selfTourViewed": True,
            "isLoading": False,
        },
        "nvp_introSelected": {"choice": "manage_team"},
        "hasNonPersonalPolicy": True,
        "personalPolicyID": "personal",
        "nvp_expensify_activePolicyID": POLICY_ID,
        "isLoadingApp": False,
        "hasLoadedApp": True,
        "shouldUseStagingServer": False,
        "hybridApp": {
            "readyToShowAuthScreens": True,
            "useNewDotSignInPage": True,
            "isLoading": False,
            "lastVisitedPath": "workspaces",
        },
        "modal": {"isVisible": False, "willAlertModalBecomeVisible": False},
        "isOpenAppFailureModalOpen": False,
        "supportalPermissionDenied": None,
        "expenseAddedGrowlTransactionIDs": {},
        "reportAttributes": {"reports": {}},
        "visibleReportActions": {},
        "currentDate": "2026-08-22",
        "country": {"country": "US"},
        "policy_personal": {
            "id": "personal",
            "name": "Personal",
            "type": "personal",
            "role": "admin",
            "ownerAccountID": ACCOUNT_ID,
            "outputCurrency": "USD",
        },
    }

    for index in range(1, 71):
        policy_id = f"ws{index:03d}"
        records[f"policy_{policy_id}"] = policy(
            policy_id,
            index,
            categories=policy_id in {POLICY_ID, EMPTY_POLICY_ID},
        )

    categories = {
        f"Regression Category {index:03d}": {
            "name": f"Regression Category {index:03d}",
            "enabled": True,
        }
        for index in range(1, 101)
    }
    records[f"policyCategories_{POLICY_ID}"] = categories
    records[f"policyCategories_{EMPTY_POLICY_ID}"] = {}

    conn.executemany(
        "INSERT INTO keyvaluepairs(record_key, valueJSON) VALUES (?, ?)",
        [(key, json.dumps(value, separators=(",", ":"))) for key, value in records.items()],
    )
    conn.commit()
    rows = conn.execute("SELECT COUNT(*) FROM keyvaluepairs").fetchone()[0]
    conn.close()
    RESULTS["seed_record_count"] = rows
    RESULTS["seed_workspace_count"] = 70
    RESULTS["seed_category_count"] = 100


def install_and_seed(package: str) -> None:
    install = adb("install", "-r", "-g", str(APK), timeout=600)
    write_text(EVIDENCE / "adb-install.txt", install.stdout + install.stderr)

    root_result = adb("root", check=False, timeout=30)
    time.sleep(2)
    adb("wait-for-device", timeout=60)
    root_id = shell("id", check=False).stdout
    write_text(EVIDENCE / "adb-root.txt", root_result.stdout + root_result.stderr + root_id)
    if "uid=0(root)" not in root_id:
        raise HarnessError("The emulator adbd is not running as root")

    app_dir = f"/data/user/0/{package}"
    uid_text = shell(f"stat -c %u {app_dir}").stdout.strip()
    if not uid_text.isdigit():
        raise HarnessError(f"Could not determine app UID: {uid_text!r}")
    uid = int(uid_text)
    RESULTS["app_uid"] = uid

    seed = Path("/tmp/OnyxDB.seed")
    create_seed_db(seed)
    adb("push", str(seed), "/data/local/tmp/OnyxDB.seed", timeout=120)
    shell(f"am force-stop {package}", check=False)
    shell(
        f"rm -f {app_dir}/files/OnyxDB {app_dir}/files/OnyxDB-shm {app_dir}/files/OnyxDB-wal && "
        f"cp /data/local/tmp/OnyxDB.seed {app_dir}/files/OnyxDB && "
        f"chown {uid}:{uid} {app_dir}/files/OnyxDB && chmod 600 {app_dir}/files/OnyxDB && "
        f"restorecon -RF {app_dir}/files"
    )

    inventory = shell(
        f"ls -lZ {app_dir}/files/OnyxDB; "
        f"stat -c '%n %s bytes %u:%g %a' {app_dir}/files/OnyxDB"
    ).stdout
    write_text(EVIDENCE / "seeded-db-inventory.txt", inventory)

    # Enforce an offline test environment at both Onyx and Android levels.
    shell("svc wifi disable", check=False)
    shell("svc data disable", check=False)
    shell("settings put global airplane_mode_on 1", check=False)
    shell("am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true", check=False)
    shell(f"iptables -I OUTPUT -m owner --uid-owner {uid} -j REJECT", check=False)
    shell("ip link set eth0 down", check=False)
    time.sleep(2)


def set_display(width: int, height: int, density: int) -> None:
    shell(f"wm size {width}x{height}")
    shell(f"wm density {density}")
    shell("settings put system accelerometer_rotation 0", check=False)
    shell("settings put system user_rotation 0", check=False)
    time.sleep(2)


def component(package: str, activity: str) -> str:
    if activity.startswith("."):
        activity = f"{package}{activity}"
    return f"{package}/{activity}"


def launch_uri(package: str, activity: str, uri: str, label: str) -> None:
    result = shell(
        "am start -W -S "
        f"-n {component(package, activity)} "
        "-a android.intent.action.VIEW "
        f"-d '{uri}'"
    , check=False, timeout=60)
    write_text(EVIDENCE / f"{label}-launch.txt", result.stdout + result.stderr)


def dump_xml(label: str) -> str:
    remote = f"/sdcard/{label}.xml"
    shell(f"uiautomator dump {remote}", check=False, timeout=30)
    result = adb("exec-out", "cat", remote, check=False, timeout=30)
    xml = result.stdout
    write_text(EVIDENCE / f"{label}-window.xml", xml)
    return xml


def screenshot(label: str) -> None:
    proc = subprocess.run([str(ADB), "exec-out", "screencap", "-p"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    (EVIDENCE / f"{label}.png").write_bytes(proc.stdout)
    if proc.stderr:
        (EVIDENCE / f"{label}-screencap-stderr.txt").write_bytes(proc.stderr)


def parse_nodes(xml: str) -> list[dict[str, str]]:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    return [dict(node.attrib) for node in root.iter("node")]


def capture(label: str) -> list[dict[str, str]]:
    screenshot(label)
    xml = dump_xml(label)
    activities = shell("dumpsys activity activities", check=False, timeout=30).stdout
    write_text(EVIDENCE / f"{label}-activities.txt", activities)
    nodes = parse_nodes(xml)
    selected: list[dict[str, str]] = []
    interesting = (
        "workspaces",
        "domains",
        "search",
        "name",
        "type",
        "role",
        "owner",
        "regression workspace",
        "categories",
        "regression category",
        "no results",
        "new",
        "enabled",
    )
    for node in nodes:
        joined = " ".join((node.get("text", ""), node.get("content-desc", ""))).lower()
        if any(token in joined for token in interesting):
            selected.append(
                {
                    key: node.get(key, "")
                    for key in ("text", "content-desc", "class", "resource-id", "bounds", "clickable", "focusable", "scrollable")
                }
            )
    write_text(EVIDENCE / f"{label}-selected-nodes.json", json.dumps(selected, indent=2))
    return nodes


def node_text(node: dict[str, str]) -> str:
    return " ".join((node.get("text", ""), node.get("content-desc", ""))).strip()


def contains_text(nodes: Iterable[dict[str, str]], needle: str) -> bool:
    lower = needle.lower()
    return any(lower in node_text(node).lower() for node in nodes)


def wait_for_text(needle: str, timeout_seconds: int = 45) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        xml = dump_xml("wait-current")
        if contains_text(parse_nodes(xml), needle):
            return True
        time.sleep(2)
    return False


def bounds_center(bounds: str) -> tuple[int, int] | None:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    if not match:
        return None
    left, top, right, bottom = (int(value) for value in match.groups())
    return ((left + right) // 2, (top + bottom) // 2)


def find_search_node(nodes: list[dict[str, str]]) -> dict[str, str] | None:
    ranked: list[tuple[int, dict[str, str]]] = []
    for node in nodes:
        text = node_text(node).lower()
        class_name = node.get("class", "").lower()
        resource_id = node.get("resource-id", "").lower()
        score = 0
        if "edittext" in class_name:
            score += 20
        if "search" in resource_id:
            score += 10
        if "search" in text:
            score += 8
        if node.get("focusable") == "true":
            score += 4
        if node.get("clickable") == "true":
            score += 2
        if score and bounds_center(node.get("bounds", "")):
            ranked.append((score, node))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return ranked[0][1] if ranked else None


def enter_no_result_search(label: str) -> bool:
    nodes = parse_nodes(dump_xml(f"{label}-before-search"))
    node = find_search_node(nodes)
    if not node:
        RESULTS["notes"].append(f"{label}: search field not found in UI hierarchy")
        return False
    center = bounds_center(node.get("bounds", ""))
    if not center:
        return False
    shell(f"input tap {center[0]} {center[1]}")
    time.sleep(1)
    shell("input keyevent KEYCODE_MOVE_END", check=False)
    for _ in range(80):
        shell("input keyevent KEYCODE_DEL", check=False, timeout=5)
    shell(f"input text {NO_RESULT_QUERY}")
    time.sleep(4)
    nodes_after = capture(label)
    no_results = contains_text(nodes_after, "No results")
    RESULTS["checks"][f"{label}_shows_no_results"] = no_results
    return no_results


def clear_search(label: str) -> None:
    shell("input keyevent KEYCODE_MOVE_END", check=False)
    for _ in range(len(NO_RESULT_QUERY) + 5):
        shell("input keyevent KEYCODE_DEL", check=False, timeout=5)
    time.sleep(3)
    shell("input keyevent KEYCODE_BACK", check=False)
    time.sleep(2)
    capture(label)


def swipe_up(repetitions: int = 3) -> None:
    size = shell("wm size").stdout
    match = re.search(r"Override size: (\d+)x(\d+)", size) or re.search(r"Physical size: (\d+)x(\d+)", size)
    width, height = (1080, 2400) if not match else (int(match.group(1)), int(match.group(2)))
    x = width // 2
    start_y = int(height * 0.80)
    end_y = int(height * 0.22)
    duration = 700
    for _ in range(repetitions):
        shell(f"input swipe {x} {start_y} {x} {end_y} {duration}")
        time.sleep(1)


def record_screen_check(name: str, nodes: list[dict[str, str]], required: list[str]) -> bool:
    found = {text: contains_text(nodes, text) for text in required}
    RESULTS["checks"][name] = found
    return all(found.values())


def main() -> int:
    process: subprocess.Popen[str] | None = None
    essential_ok = True
    try:
        process = boot_emulator()
        package, activity = apk_identifiers()
        RESULTS["package"] = package
        RESULTS["activity"] = activity
        write_text(EVIDENCE / "app-identifiers.txt", f"package={package}\nactivity={activity}\n")
        install_and_seed(package)
        adb("logcat", "-c", check=False)

        # Narrow portrait workspaces.
        set_display(1080, 2400, 420)
        launch_uri(package, activity, "expensify://open/workspaces", "10-workspaces-narrow")
        narrow_loaded = wait_for_text("Regression Workspace 001", 60)
        time.sleep(4)
        narrow_nodes = capture("10-workspaces-narrow-initial")
        narrow_ok = narrow_loaded and record_screen_check(
            "workspaces_narrow_initial",
            narrow_nodes,
            ["Workspaces", "Regression Workspace 001"],
        )
        essential_ok &= narrow_ok
        swipe_up(4)
        narrow_scrolled = capture("11-workspaces-narrow-scrolled")
        RESULTS["checks"]["workspaces_narrow_scrolled_has_later_row"] = any(
            "Regression Workspace" in node_text(node) and "001" not in node_text(node)
            for node in narrow_scrolled
        )

        # Wide table layout: the principal dynamic-column regression target.
        set_display(1600, 1000, 200)
        launch_uri(package, activity, "expensify://open/workspaces", "20-workspaces-wide")
        wide_loaded = wait_for_text("Regression Workspace 001", 60)
        time.sleep(4)
        wide_nodes = capture("20-workspaces-wide-initial")
        wide_ok = wide_loaded and record_screen_check(
            "workspaces_wide_initial",
            wide_nodes,
            ["Workspaces", "Regression Workspace 001"],
        )
        essential_ok &= wide_ok
        swipe_up(5)
        wide_scrolled = capture("21-workspaces-wide-scrolled")
        RESULTS["checks"]["workspaces_wide_scrolled_has_later_row"] = any(
            "Regression Workspace" in node_text(node) and "001" not in node_text(node)
            for node in wide_scrolled
        )
        enter_no_result_search("22-workspaces-wide-no-results")
        clear_search("23-workspaces-wide-cleared")

        # Populated categories page.
        launch_uri(package, activity, f"expensify://open/workspaces/{POLICY_ID}/categories", "30-categories-wide")
        categories_loaded = wait_for_text("Regression Category 001", 60)
        time.sleep(4)
        category_nodes = capture("30-categories-wide-initial")
        categories_ok = categories_loaded and record_screen_check(
            "categories_populated_initial",
            category_nodes,
            ["Categories", "Regression Category 001"],
        )
        essential_ok &= categories_ok
        swipe_up(5)
        category_scrolled = capture("31-categories-wide-scrolled")
        RESULTS["checks"]["categories_scrolled_has_later_row"] = any(
            "Regression Category" in node_text(node) and "001" not in node_text(node)
            for node in category_scrolled
        )
        enter_no_result_search("32-categories-wide-no-results")
        clear_search("33-categories-wide-cleared")

        # Empty-state page must retain page-level controls.
        launch_uri(package, activity, f"expensify://open/workspaces/{EMPTY_POLICY_ID}/categories", "40-categories-empty")
        empty_loaded = wait_for_text("Categories", 60)
        time.sleep(4)
        empty_nodes = capture("40-categories-empty-initial")
        empty_ok = empty_loaded and contains_text(empty_nodes, "Categories")
        RESULTS["checks"]["categories_empty_page_loaded"] = empty_ok
        RESULTS["checks"]["categories_empty_search_visible"] = find_search_node(empty_nodes) is not None
        essential_ok &= empty_ok

        # Direct relaunch/deep-link smoke for initial sticky-header/load errors.
        launch_uri(package, activity, f"expensify://open/workspaces/{POLICY_ID}/categories", "50-categories-direct-relaunch")
        relaunch_loaded = wait_for_text("Regression Category 001", 60)
        time.sleep(3)
        relaunch_nodes = capture("50-categories-direct-relaunch")
        RESULTS["checks"]["categories_direct_relaunch_loaded"] = relaunch_loaded
        essential_ok &= relaunch_loaded

        # Capture a focused search field with the landscape keyboard visible.
        search_node = find_search_node(relaunch_nodes)
        if search_node and (center := bounds_center(search_node.get("bounds", ""))):
            shell(f"input tap {center[0]} {center[1]}")
            shell("input text keyboardvisibility")
            time.sleep(3)
            capture("60-landscape-search-keyboard")
            RESULTS["checks"]["landscape_search_focus_exercised"] = True
        else:
            RESULTS["checks"]["landscape_search_focus_exercised"] = False

        logcat = adb("logcat", "-d", "-v", "threadtime", check=False, timeout=60).stdout
        write_text(EVIDENCE / "logcat-full.txt", logcat)
        important_pattern = re.compile(
            r"FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|SIG(?:SEGV|ABRT)|ErrorBoundary|Unhandled|TypeError|ReferenceError|Invariant Violation",
            re.IGNORECASE,
        )
        important = "\n".join(line for line in logcat.splitlines() if important_pattern.search(line))
        write_text(EVIDENCE / "logcat-important.txt", important + ("\n" if important else ""))
        RESULTS["important_log_lines"] = len(important.splitlines()) if important else 0

        exit_info = shell(f"dumpsys activity exit-info {package}", check=False, timeout=30).stdout
        write_text(EVIDENCE / "app-exit-info.txt", exit_info)
        RESULTS["checks"]["no_crash_exit_record"] = not bool(re.search(r"REASON_CRASH|REASON_ANR", exit_info, re.IGNORECASE))
        RESULTS["checks"]["no_js_or_native_fatal_in_logcat"] = not bool(
            re.search(r"FATAL EXCEPTION|SIG(?:SEGV|ABRT)|ReactNativeJS.*(?:TypeError|ReferenceError|Invariant)", important, re.IGNORECASE)
        )

        all_xml_text = "\n".join(path.read_text(encoding="utf-8", errors="replace") for path in EVIDENCE.glob("*-window.xml"))
        error_boundary = bool(
            re.search(
                r"Something went wrong|Unexpected error|Error boundary|We're having trouble loading",
                all_xml_text,
                re.IGNORECASE,
            )
        )
        RESULTS["checks"]["no_error_boundary_text"] = not error_boundary
        essential_ok &= not error_boundary

        meminfo = shell(f"dumpsys meminfo {package}", check=False, timeout=30).stdout
        write_text(EVIDENCE / "meminfo.txt", meminfo)
        gfxinfo = shell(f"dumpsys gfxinfo {package}", check=False, timeout=30).stdout
        write_text(EVIDENCE / "gfxinfo.txt", gfxinfo)
        db_inventory = shell(
            f"ls -lZ /data/user/0/{package}/files/OnyxDB*; "
            f"stat -c '%n %s bytes %u:%g %a' /data/user/0/{package}/files/OnyxDB*",
            check=False,
        ).stdout
        write_text(EVIDENCE / "final-db-inventory.txt", db_inventory)

    except Exception as exc:  # noqa: BLE001 - evidence must survive any harness failure
        RESULTS["harness_exception"] = f"{type(exc).__name__}: {exc}"
        write_text(EVIDENCE / "harness-exception.txt", RESULTS["harness_exception"] + "\n")
        essential_ok = False
    finally:
        RESULTS["essential_scenarios_passed"] = essential_ok
        write_text(EVIDENCE / "regression-summary.json", json.dumps(RESULTS, indent=2, sort_keys=True))
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.copy2(__file__, EVIDENCE / "executed-seeded-table-regression.py")

    return 0 if essential_ok else 1


if __name__ == "__main__":
    sys.exit(main())
