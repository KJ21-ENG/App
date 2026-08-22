#!/usr/bin/env python3
"""Load the seeded regression harness with ADB-safe and diagnostic wrappers."""

from __future__ import annotations

import importlib.util
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
    # first launch. Create and own it before installing the deterministic DB.
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
    if package and "seeded-db-inventory.txt" not in command and "stat -c" in command and "OnyxDB*" not in command:
        pull_database("seeded", package)

    return result


original_wait_for_text = module.wait_for_text


def diagnostic_wait_for_text(needle: str, timeout_seconds: int = 45) -> bool:
    # The first workspace row is the authentication/state gate. Fail quickly
    # and capture the live DB instead of spending nine minutes on redirects.
    effective_timeout = min(timeout_seconds, 25) if needle == "Regression Workspace 001" else timeout_seconds
    found = original_wait_for_text(needle, effective_timeout)
    if needle != "Regression Workspace 001" or found:
        return found

    package = str(module.RESULTS.get("package") or "")
    if package:
        module.capture("09-seed-auth-diagnostic")
        module.shell(f"am force-stop {package}", check=False)
        time.sleep(2)
        pull_database("post-launch", package)
    raise RuntimeError("Seeded session did not expose Regression Workspace 001")


module.shell = fixed_shell
module.wait_for_text = diagnostic_wait_for_text
sys.exit(module.main())
