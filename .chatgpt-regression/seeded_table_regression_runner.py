#!/usr/bin/env python3
"""Load the seeded regression harness with an ADB-safe shell wrapper."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

HARNESS = Path(__file__).with_name("seeded_table_regression.py")
spec = importlib.util.spec_from_file_location("seeded_table_regression", HARNESS)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {HARNESS}")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def fixed_shell(command: str, *, check: bool = True, timeout: int | float | None = 120):
    # adb joins arguments before handing them to Android's shell. Passing
    # `sh`, `-c`, and a spaced command as separate argv entries loses the
    # required quoting (e.g. `getprop sys.boot_completed` becomes `sh -c
    # getprop`). Send the complete command as one adb-shell argument instead.
    #
    # A freshly installed hybrid APK does not create its files directory until
    # first launch. The deterministic seed is written before launch, so create
    # and correctly own that directory when the OnyxDB copy command is issued.
    if "cp /data/local/tmp/OnyxDB.seed" in command:
        directory_match = re.search(r"cp /data/local/tmp/OnyxDB\.seed (/data/user/0/[^/]+/files)/OnyxDB", command)
        owner_match = re.search(r"chown (\d+:\d+) /data/user/0/[^/]+/files/OnyxDB", command)
        if directory_match and owner_match:
            app_files_dir = directory_match.group(1)
            owner = owner_match.group(1)
            command = f"mkdir -p {app_files_dir} && chown {owner} {app_files_dir} && chmod 700 {app_files_dir} && {command}"

    return module.adb("shell", command, check=check, timeout=timeout)


module.shell = fixed_shell
sys.exit(module.main())
