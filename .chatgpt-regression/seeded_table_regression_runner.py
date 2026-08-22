#!/usr/bin/env python3
"""Load the seeded regression harness with ADB-safe and hybrid identity wrappers."""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import time
from pathlib import Path

HARNESS = Path(__file__).with_name("seeded_table_regression.py")
spec = importlib.util.spec_from_file_location("seeded_table_regression", HARNESS)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {HARNESS}")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def pull_database(stage: str, package: str) -> None:
    """Capture all SQLite files while the rooted emulator is still alive."""
    for suffix in ("", "-wal", "-shm"):
        source = f"/data/user/0/{package}/files/OnyxDB{suffix}"
        destination = module.EVIDENCE / f"OnyxDB-{stage}{suffix}"
        module.adb("pull", source, str(destination), check=False, timeout=60)


def fixed_shell(command: str, *, check: bool = True, timeout: int | float | None = 120):
    # adb joins arguments before handing them to Android's shell. Send the
    # complete command as one adb-shell argument so spaced commands retain
    # their intended quoting.
    package_match = re.search(r"/data/user/0/([^/]+)/files/OnyxDB", command)
    package = package_match.group(1) if package_match else None

    # A freshly installed hybrid APK does not create its files directory until
    # first launch. Create and own it before installing deterministic storage.
    if "cp /data/local/tmp/OnyxDB.seed" in command:
        directory_match = re.search(r"cp /data/local/tmp/OnyxDB\.seed (/data/user/0/[^/]+/files)/OnyxDB", command)
        owner_match = re.search(r"chown (\d+:\d+) /data/user/0/[^/]+/files/OnyxDB", command)
        if directory_match and owner_match:
            app_files_dir = directory_match.group(1)
            owner = owner_match.group(1)
            command = f"mkdir -p {app_files_dir} && chown {owner} {app_files_dir} && chmod 700 {app_files_dir} && {command}"

    result = module.adb("shell", command, check=check, timeout=timeout)

    # The seed inventory command runs immediately after the copy and before the
    # first app process. Preserve that exact DB for host-side comparison.
    if package and "stat -c" in command and "OnyxDB*" not in command:
        pull_database("seeded", package)

    return result


def seed_olddot_identity(package: str) -> None:
    """Make the hybrid shell report the same signed-in identity as seeded Onyx.

    OldDot constructs HybridAppSettings from state_v19.json. When that state is
    unsigned, NewDot intentionally clears Onyx and opens the sign-in page. A
    matching, synthetic, offline OldDot identity keeps the deterministic Onyx
    database intact without using real credentials or network APIs.
    """
    uid = int(module.RESULTS["app_uid"])
    app_dir = f"/data/user/0/{package}"
    state = {
        "isOnStaging": True,
        "lastUsedEmail": module.LOGIN,
        "history": [],
        "pageExtrasHistory": [],
        "accountInfo": {
            "email": module.LOGIN,
            "authToken": "offline-regression-auth-token",
            "encryptedAuthToken": "offline-regression-auth-token",
            "accountID": module.ACCOUNT_ID,
            "hasSetPassword": False,
        },
        "scanReceipt": True,
        "pages": {},
        "queued": [],
        "appUserEmail": module.LOGIN,
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
    local_state = Path("/tmp/state_v19.json")
    local_state.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    module.adb("push", str(local_state), "/data/local/tmp/state_v19.json", timeout=60)
    module.shell(
        f"mkdir -p {app_dir}/files && "
        f"rm -f {app_dir}/files/savedState.json {app_dir}/files/state_v*.json && "
        f"cp /data/local/tmp/state_v19.json {app_dir}/files/state_v19.json && "
        f"chown {uid}:{uid} {app_dir}/files/state_v19.json && "
        f"chmod 600 {app_dir}/files/state_v19.json && "
        f"restorecon -RF {app_dir}/files"
    )
    inventory = module.shell(
        f"echo '=== files before first launch ==='; "
        f"find {app_dir}/files -maxdepth 2 -type f -printf '%p %s bytes %u:%g %m\\n' | sort; "
        f"echo '=== seeded OldDot state ==='; cat {app_dir}/files/state_v19.json",
        check=False,
        timeout=30,
    ).stdout
    module.write_text(module.EVIDENCE / "seeded-storage-inventory.txt", inventory)
    module.RESULTS["olddot_state_seeded"] = True


original_install_and_seed = module.install_and_seed


def install_and_seed_with_hybrid_identity(package: str) -> None:
    original_install_and_seed(package)
    seed_olddot_identity(package)


original_wait_for_text = module.wait_for_text


def diagnostic_wait_for_text(needle: str, timeout_seconds: int = 45) -> bool:
    # The first workspace row is the authentication/state gate. Allow the
    # OldDot -> NewDot bridge to complete, then retain live storage on failure.
    effective_timeout = min(timeout_seconds, 60) if needle == "Regression Workspace 001" else timeout_seconds
    found = original_wait_for_text(needle, effective_timeout)
    if needle != "Regression Workspace 001" or found:
        return found

    package = str(module.RESULTS.get("package") or "")
    if package:
        module.capture("09-seed-auth-diagnostic")
        inventory = module.shell(
            f"echo '=== files after failed launch ==='; "
            f"find /data/user/0/{package}/files -maxdepth 3 -type f -printf '%p %s bytes %u:%g %m\\n' | sort; "
            f"echo '=== persisted OldDot state ==='; "
            f"cat /data/user/0/{package}/files/state_v19.json 2>/dev/null || true",
            check=False,
            timeout=30,
        ).stdout
        module.write_text(module.EVIDENCE / "post-launch-storage-inventory.txt", inventory)
        module.shell(f"am force-stop {package}", check=False)
        time.sleep(2)
        pull_database("post-launch", package)
    raise RuntimeError("Seeded session did not expose Regression Workspace 001")


module.shell = fixed_shell
module.install_and_seed = install_and_seed_with_hybrid_identity
module.wait_for_text = diagnostic_wait_for_text
sys.exit(module.main())
