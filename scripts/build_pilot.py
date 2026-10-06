#!/usr/bin/env python3
"""Trusted control-branch build packaging. Never runs the application locally."""

import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import time

REPOSITORY = "KJ21-ENG/App"
SOURCE_SHA = "0e3856899284b5025d623f7be15b547f995c2672"
HEAD_SHA = "bff6c6b0dc427c726643083d218644a59ca8e370"
CONTROL_BRANCH = "qa-static-pilot-100677"
ORIGIN = "http://127.0.0.1:18484"
APP = Path("/srv/expensify-qa-static")
STATE = Path("/opt/expensify-qa-state")
OUT = Path("/opt/expensify-qa-artifact")
MAX_FILES = 20000
MAX_BYTES = 256 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
BLOBS = {
    "package.json": "fdc9dfa1d03a76b6d752bb10ae39c2b787997426",
    "src/CONFIG.ts": "3244dad9a01f33ca6ac887ef3345f69fc2acbba3",
    "src/libs/ApiUtils.ts": "fef6b1a242f84068c27bca51183ec62e9be1c413",
    "src/libs/HttpUtils.ts": "9877f4dd861d9ca98d4015e1b12d7f4142c8d7ae",
    "config/rsbuild/rsbuild.config.ts": "d5140d759494faf761ba19b3feaeeef26354e67b",
    "config/rsbuild/rsbuild.common.ts": "70eee16a72160d14aec0c32ada90fe79a0072760",
    "web/index.html": "36e10f9ccfd3f563b07328f6e21a197c05b9bb02",
    "web/proxy.ts": "101a859abb7fa040181d27b5d4201d3ede992d6d",
    "src/setup/platformSetup/index.ts": "55503509e6d4fd7fa2ddb5f4d78bdf0e31abcac3",
    "scripts/postInstall.sh": "bd95fa016e403440bece001187ca467b2f040ffc",
}
ENVIRONMENT = {
    "ENVIRONMENT": "development",
    "NEW_EXPENSIFY_URL": ORIGIN + "/",
    "EXPENSIFY_URL": ORIGIN + "/staging/",
    "STAGING_EXPENSIFY_URL": ORIGIN + "/staging/",
    "SECURE_EXPENSIFY_URL": ORIGIN + "/staging-secure/",
    "STAGING_SECURE_EXPENSIFY_URL": ORIGIN + "/staging-secure/",
    "USE_WEB_PROXY": "true",
    "USE_NGROK": "false",
    "QA_EXPENSIFY_URL": "",
    "QA_SECURE_EXPENSIFY_URL": "",
    "QA_CF_TEAM_DOMAIN": "",
    "QA_CF_OAUTH_CLIENT_ID": "",
    "QA_AUTH_CHECK_PATH": "",
    "USE_THIRD_PARTY_SCRIPTS": "false",
    "SEND_CRASH_REPORTS": "false",
    "ENABLE_SENTRY_ON_DEV": "false",
    "SENTRY_DSN": "",
    "CAPTURE_METRICS": "false",
    "ONYX_METRICS": "false",
    "SKIP_ONBOARDING": "false",
    "PUSHER_APP_KEY": "268df511a204fbb60884",
}
ROUTES = [
    {"prefix": "/api/", "upstream": "https://staging.expensify.com/api/"},
    {"prefix": "/staging/api/", "upstream": "https://staging.expensify.com/api/"},
    {"prefix": "/staging-secure/api/", "upstream": "https://staging-secure.expensify.com/api/"},
]
BACKEND_ORIGINS = ["https://staging.expensify.com", "https://staging-secure.expensify.com"]
COMMAND = [
    "node", "./node_modules/.bin/rsbuild", "build", "--mode", "development",
    "--no-source-map", "--config", "config/rsbuild/rsbuild.config.ts",
]
CONVERT_BLOCK = """    <% if (isWeb) { %>
        <!-- begin Convert Experiences code-->
        <script type="text/javascript" src="//cdn-4.convertexperiments.com/v1/js/10042537-100413459.js">
        </script>
        <!-- end Convert Experiences code -->
    <% } %>
"""


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def env_bytes():
    return "".join(key + "=" + value + "\n" for key, value in sorted(ENVIRONMENT.items())).encode()


def validate_identity(e):
    require(e.get("GITHUB_REPOSITORY") == REPOSITORY, "Unexpected repository")
    require(e.get("GITHUB_EVENT_NAME") == "push", "Only the dedicated branch push is supported")
    require(e.get("GITHUB_REF") == "refs/heads/" + CONTROL_BRANCH, "Wrong control branch")
    require(e.get("GITHUB_RUN_ATTEMPT") == "1", "A rerun is not a new reviewed build")
    for name in ("GITHUB_SHA", "GITHUB_WORKFLOW_SHA"):
        require(re.fullmatch(r"[0-9a-f]{40}", e.get(name, "")), "Exact workflow commit missing")
    require(e["GITHUB_SHA"] == e["GITHUB_WORKFLOW_SHA"], "Workflow commit differs from pushed control commit")
    require(re.fullmatch(r"[1-9][0-9]{0,19}", e.get("GITHUB_RUN_ID", "")), "Invalid run ID")
    require(e.get("QA_REPOSITORY_VISIBILITY") == "public", "Public-repository $0 boundary failed")
    return {
        "repository": REPOSITORY,
        "workflowPath": ".github/workflows/qa-static-pilot.yml",
        "workflowCommit": e["GITHUB_SHA"],
        "ref": e["GITHUB_REF"],
        "event": "push",
        "runId": int(e["GITHUB_RUN_ID"]),
        "runAttempt": 1,
    }


def remove_convert(raw):
    text = raw.decode("utf-8")
    require(text.count(CONVERT_BLOCK) == 1, "Expected Convert HTML block missing or duplicated")
    patched = text.replace(CONVERT_BLOCK, "", 1)
    require("convertexperiments.com" not in patched, "Unexpected remaining Convert script")
    patch = "".join(difflib.unified_diff(text.splitlines(True), patched.splitlines(True), fromfile="a/web/index.html", tofile="b/web/index.html"))
    return patched.encode(), {
        "path": "web/index.html",
        "purpose": "Remove only the unconditional scheme-relative Convert third-party script for private loopback QA",
        "beforeSha256": sha256(raw),
        "afterSha256": sha256(patched.encode()),
        "patchSha256": sha256(patch.encode()),
        "patch": patch,
    }


def fingerprint(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "Source must contain regular single-link tracked files")
    return {"sha256": sha256(path.read_bytes()), "executable": bool(info.st_mode & 0o111)}


def source_snapshot(checkout):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(checkout), *args]).decode().strip()
    require(git("rev-parse", "HEAD") == SOURCE_SHA, "Source checkout SHA mismatch")
    require(not git("status", "--porcelain"), "Source checkout is not clean")
    for name, expected in BLOBS.items():
        require(git("hash-object", name) == expected, "Reviewed source configuration changed")
    snapshot = {}
    entries = subprocess.check_output(["git", "-C", str(checkout), "ls-files", "--stage", "-z"]).split(b"\0")
    for entry in entries:
        if not entry:
            continue
        meta, raw_name = entry.split(b"\t", 1)
        mode, _, stage = meta.decode().split()
        require(stage == "0", "Unmerged source path")
        if mode == "160000":
            continue
        require(mode in ("100644", "100755"), "Unreviewed tracked link or special file")
        name = raw_name.decode()
        path = checkout / name
        require(path.resolve().is_relative_to(checkout.resolve()), "Source path escapes checkout")
        snapshot[name] = fingerprint(path)
    return snapshot, git("rev-parse", "HEAD^{tree}")


def prepare(checkout):
    workflow = validate_identity(os.environ)
    snapshot, tree = source_snapshot(checkout)
    for name, item in snapshot.items():
        require(fingerprint(APP / name) == item, "Source transfer changed tracked bytes")
    pkg = json.loads((APP / "package.json").read_text())
    require(pkg["name"] == "new.expensify" and pkg["version"] == "9.4.81-0", "Package identity changed")
    require(pkg["engines"] == {"node": "26.5.0", "npm": "11.17.0", "bun": "1.3.14"}, "Reviewed toolchain changed")
    require((APP / ".nvmrc").read_text().strip() == "26.5.0", "Node file differs from toolchain")
    html = APP / "web/index.html"
    patched, overlay = remove_convert(html.read_bytes())
    html.write_bytes(patched)
    snapshot["web/index.html"] = fingerprint(html)
    env = APP / ".env"
    require(not env.exists() and not env.is_symlink(), "Unreviewed source environment exists")
    env.write_bytes(env_bytes())
    # File remains nonsecret, but source scripts cannot silently edit it in place.
    app_user = pwd.getpwnam("qaapp")
    os.chown(env, 0, app_user.pw_gid)
    env.chmod(0o440)
    data = {
        "schemaVersion": 1,
        "artifactName": "qa-static-100677-" + str(workflow["runId"]) + "-1",
        "source": {"repository": REPOSITORY, "sha": SOURCE_SHA, "treeSha": tree, "pilotPr": 100677,
                   "pilotHeadSha": HEAD_SHA, "upstreamRepository": "Expensify/App"},
        "workflow": workflow,
        "build": {
            "mode": "development", "command": COMMAND, "nodeVersion": "26.5.0", "npmVersion": "11.17.0", "bunVersion": "1.3.14",
            "packageVersion": "9.4.81-0", "sourceMap": False, "serviceWorker": False,
            "environmentSha256": sha256(env_bytes()),
            "dependencyLockSha256": sha256((APP / "package-lock.json").read_bytes()),
            "environment": {"localOrigin": ORIGIN, "backendOrigins": BACKEND_ORIGINS, "variables": ENVIRONMENT},
        },
        "routes": ROUTES,
        "overlays": [overlay],
        "sourceFiles": {name: {"gitBlob": blob, "sha256": sha256((checkout / name).read_bytes())} for name, blob in BLOBS.items()},
    }
    write_json(STATE / "snapshot.json", snapshot)
    write_json(STATE / "manifest-base.json", data)
    print("Exact selected merge source, nonsecret loopback environment and HTML-only overlay prepared.")



def discard_verified_install_cache(root, snapshot):
    # Exact pilot module postinstall runs tsc. Its tsconfig sets this cache path,
    # inheriting noEmit:true and incremental:true from tsconfig.base.json.
    # This is disposable compiler metadata, not executable output or source.
    relative = "modules/ExpensifyNitroUtils/tsconfig.ts7.tsbuildinfo"
    path = root / relative
    if not path.exists() and not path.is_symlink():
        return False
    require(relative not in snapshot, "Generated cache unexpectedly overlaps tracked source")
    require(path.resolve().is_relative_to(root.resolve()), "Generated cache escaped source root")
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o111,
            "Unexpected generated compiler-cache type, link count or executable mode")
    require(info.st_size <= 16 * 1024 * 1024, "Generated compiler cache exceeds expected bound")
    path.unlink()
    print("Discarded verified generated compiler cache: " + relative)
    return True


def diagnostic_path(relative):
    # Filenames only, never file contents. Avoid control/workflow-command syntax.
    return re.sub(r"[^A-Za-z0-9_./-]", "?", relative)[:240]


def inspect_untracked(root, snapshot):
    dependency_roots = {(Path(name).parent / "node_modules").as_posix() for name in snapshot if Path(name).name == "package.json"}
    directories = set()
    unexpected = []
    for folder, dirs, files in os.walk(root, followlinks=False):
        parent = Path(folder)
        directories.add(parent)
        for name in list(dirs):
            relative = (parent / name).relative_to(root).as_posix()
            if relative in dependency_roots or relative in (".git", "dist"):
                dirs.remove(name)
                continue
            require(not (parent / name).is_symlink(), "Untracked source directory symlink: " + diagnostic_path(relative))
        for name in files:
            relative = (parent / name).relative_to(root).as_posix()
            if relative not in snapshot and relative != ".env":
                unexpected.append(diagnostic_path(relative))
    require(not unexpected, "Untracked source overlay outside dependency/output allowlist: " + json.dumps(unexpected[:20]) + (" (additional paths omitted)" if len(unexpected) > 20 else ""))
    return directories


def verify_source(lock=False):
    snapshot = json.loads((STATE / "snapshot.json").read_text())
    parents = {APP}
    for name, item in snapshot.items():
        path = APP / name
        require(path.resolve().is_relative_to(APP), "Source path escaped application")
        require(fingerprint(path) == item, "Source changed outside the disclosed HTML overlay")
        if lock:
            os.chown(path, 0, 0)
            path.chmod(0o755 if item["executable"] else 0o644)
    if lock:
        discard_verified_install_cache(APP, snapshot)
    parents.update(inspect_untracked(APP, snapshot))
    app_user = pwd.getpwnam("qaapp")
    if lock:
        for path in parents:
            os.chown(path, 0, 0)
            path.chmod(0o755)
    env = APP / ".env"
    require(fingerprint(env)["sha256"] == sha256(env_bytes()), "Loopback environment changed")
    if lock:
        os.chown(env, 0, app_user.pw_gid)
        env.chmod(0o440)
        dist = APP / "dist"
        require(not any(name == "dist" or name.startswith("dist/") for name in snapshot), "Output overlaps tracked source")
        require(not dist.is_symlink() and (not dist.exists() or dist.is_dir()), "Invalid build output directory")
        dist.mkdir(mode=0o700, exist_ok=True)
        os.chown(dist, app_user.pw_uid, app_user.pw_gid)
        dist.chmod(0o700)
    print("Tracked source and complete nonsecret environment verified.")


def inventory_dist(root):
    files = []
    total = 0
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), "Build output contains a symbolic link")
        if path.is_dir():
            continue
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "Build output contains a link or special file")
        relative = path.relative_to(root).as_posix()
        require(not any(part in ("", ".", "..") for part in Path(relative).parts), "Unsafe artifact path")
        require(not re.search(r"[\x00-\x1f\x7f]", relative), "Artifact path contains control characters")
        require(path.suffix not in (".map", ".pem", ".key") and path.name != ".env", "Disallowed build output type")
        require(path.name not in ("service-worker.js", "sw.js"), "Unexpected service worker in development-mode build")
        require(info.st_size <= MAX_FILE_BYTES, "Individual build file exceeds size limit")
        total += info.st_size
        require(total <= MAX_BYTES, "Build exceeds the bounded artifact size")
        files.append({"path": "dist/" + relative, "sha256": sha256(path.read_bytes()), "size": info.st_size})
        require(len(files) <= MAX_FILES, "Build has too many files")
    require(files and any(f["path"] == "dist/index.html" for f in files), "No static app index produced")
    return files


def finalize():
    verify_source()
    dist = APP / "dist"
    files = inventory_dist(dist)
    html = (dist / "index.html").read_text()
    require("convertexperiments.com" not in html and "googletagmanager.com" not in html and "ketchcdn.com" not in html, "Unexpected third-party script in generated HTML")
    require(not re.search(r"<script[^>]+src=[\"'](?:https?:)?//", html, re.I), "Generated HTML loads an external script")
    require(json.loads((dist / "version.json").read_text())["version"] == "9.4.81-0", "Generated version does not match source")
    require(not OUT.exists(), "Artifact staging directory must be fresh")
    OUT.mkdir(mode=0o755)
    shutil.copytree(dist, OUT / "dist", symlinks=False)
    require(inventory_dist(OUT / "dist") == files, "Artifact staging changed output bytes")
    manifest = json.loads((STATE / "manifest-base.json").read_text())
    manifest["files"] = files
    manifest["builtAtEpoch"] = int(time.time())
    write_json(OUT / "artifact-manifest.json", manifest)
    for path in OUT.rglob("*"):
        path.chmod(0o755 if path.is_dir() else 0o644)
    manifest_digest = sha256((OUT / "artifact-manifest.json").read_bytes())
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("artifact_name=" + manifest["artifactName"] + "\n")
        output.write("manifest_sha256=" + manifest_digest + "\n")
    print(json.dumps({"artifactName": manifest["artifactName"], "sourceSha": SOURCE_SHA,
                      "runId": manifest["workflow"]["runId"], "manifestSha256": manifest_digest,
                      "files": len(files), "uncompressedBytes": sum(item["size"] for item in files)}))



def redact_diagnostics(raw):
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", raw.decode("utf-8", "replace"))
    lines = []
    for line in text.replace("\r", "\n").splitlines()[-80:]:
        if re.search(r"token|secret|password|cookie|authorization|credential", line, re.I):
            lines.append("[sensitive-looking diagnostic line omitted]")
            continue
        for value in ENVIRONMENT.values():
            if len(value) >= 3:
                line = line.replace(value, "[environment value]")
        line = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", line)
        lines.append(line[:500])
    return "\n".join(lines)[-20000:]


def diagnostics():
    # No app login or personal/provider secret is present in this static build.
    # Disable workflow-command parsing while showing bounded redacted diagnostics.
    import secrets
    marker = "qa-log-" + secrets.token_hex(16)
    print("::stop-commands::" + marker, flush=True)
    try:
        for name in ("install.log", "build.log"):
            path = STATE / name
            if not path.is_file():
                continue
            with path.open("rb") as source:
                source.seek(max(0, path.stat().st_size - 65536))
                raw = source.read(65536)
            print("Bounded redacted " + name + ":")
            print(redact_diagnostics(raw))
    finally:
        print("::" + marker + "::", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "lock", "finalize", "diagnostics"))
    parser.add_argument("--checkout", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        require(args.checkout is not None, "Source checkout path required")
        prepare(args.checkout)
    elif args.command == "lock":
        verify_source(lock=True)
    elif args.command == "finalize":
        finalize()
    else:
        diagnostics()


if __name__ == "__main__":
    main()
