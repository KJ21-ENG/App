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
import copy
import urllib.error
import urllib.request
import urllib.parse
import datetime as dt

REPOSITORY = "KJ21-ENG/App"
REPOSITORY_ID = 1146901517
OWNER_ID = 140263938
OWNER = "KJ21-ENG"
UPSTREAM = "Expensify/App"
CONTROL_BRANCH = 'qa-batch-102992-dc9905d1770c6336f87ae76fcdbfae01'
ORIGIN = 'http://127.0.0.1:18523'
APP = Path("/srv/expensify-qa-static")
STATE = Path("/opt/expensify-qa-state")
OUT = Path("/opt/expensify-qa-artifact")
MAX_FILES = 20000
MAX_BYTES = 256 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
COMPATIBILITY = {'absentPaths': ['npm-shrinkwrap.json', '.env', '.env.local', '.env.development', '.env.development.local'], 'blobs': {'.npmrc': '2a14ea859d36bcf902b00e71608da173e9dbc4a9', '.nvmrc': '3eb1386fcc084ec86ac8d453d7e77fccc10d1fb0', 'babel.config.js': '3f80cb755e547ee7d74724227b9dcb6d7cb17222', 'config/rsbuild/rsbuild.common.ts': '016ae81044a9db0ef6e47c1999bb4817556fbc3c', 'config/rsbuild/rsbuild.config.ts': 'd5140d759494faf761ba19b3feaeeef26354e67b', 'scripts/postInstall.sh': 'bd95fa016e403440bece001187ca467b2f040ffc', 'src/CONFIG.ts': '3681f9f0038667f6e73f80f8f37ced231b304bee', 'src/libs/ApiUtils.ts': '9cc5fb8de91baf5df0f5b395323da6f8e96bb544', 'src/libs/HttpUtils.ts': 'd4ad52b448b9050714c02807b90d94439cdb4de8', 'src/libs/VersionUtils.ts': 'f5fc175eed5d9afa4ea76abfb6263dce0b646573', 'src/libs/telemetry/sentryApplicationKey.ts': 'dbd328d93f84e2e2ab35ec70c45056ca7b9a47a6', 'src/setup/platformSetup/index.ts': '55503509e6d4fd7fa2ddb5f4d78bdf0e31abcac3', 'tsconfig.app.json': 'ff95333aff5cb032553c99590dc08e1d812cfaf0', 'tsconfig.base.json': '2ef26e24d0fae2995162a3984005f938f0f89e27', 'tsconfig.json': '992f4ceb291b212495f9839744dcef2ae13f0ab0', 'web/index.html': 'da7a135748b5763f62558874bd498fe93ff7d497', 'web/proxy.ts': '101a859abb7fa040181d27b5d4201d3ede992d6d'}, 'id': 'expensify-rsbuild-static-20261005-v1', 'packageJsonCanonicalSha256': '9ed3d28ba4460d741dad35ccd99fefd75d350e17856dfadbf24191e6737dc940', 'packageLockCanonicalSha256': '14b2437a84b7fc781026184e1ac9d13690c238d3e6c1453d43bdcacfa598d956', 'trees': {'config': '1cce4aad53f1068272477b3fb5b322718e48080e', 'modules': '2282bab02c93c5d1ac0196f1b4f30909237df02b', 'patches': 'f7e0e053a4bb5ba5f8d2498daaaee9ba3e04d9a4', 'scripts': '948bf5f369e41fa04ce65e5c85493c6f38af84e0'}}
BLOBS = COMPATIBILITY["blobs"]

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


def valid_sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None and value != "0" * 40


def validate_inputs(e):
    # Selection is code-reviewed and immutable in this exact control commit.
    expected = {'pr': 102992, 'source_sha': '6872eaf1d7f24fa612f7876687677fbad10bad1e', 'head_sha': '6872eaf1d7f24fa612f7876687677fbad10bad1e', 'tree_sha': '3810037b5541e1f6228b05eb2b44906020075925', 'session_id': 'qa-dc9905d1770c6336f87ae76fcdbfae01'}
    require(all(e.get("INPUT_" + key.upper()) == str(value) for key, value in expected.items()),
            "Batch source or session differs from the reviewed control commit")
    require(expected["source_sha"] == expected["head_sha"], "Batch must build the current PR head")
    return dict(expected)


def expected_run_name(request):
    return ("qa-static: PR" + str(request["pr"]) + " source=" + request["source_sha"]
            + " head=" + request["head_sha"] + " tree=" + request["tree_sha"]
            + " session=" + request["session_id"])


def validate_identity(e):
    request = validate_inputs(e)
    require(e.get("GITHUB_REPOSITORY") == REPOSITORY, "Unexpected repository")
    require(e.get("GITHUB_REPOSITORY_ID") == str(REPOSITORY_ID), "Repository ID changed")
    require(e.get("GITHUB_REPOSITORY_OWNER_ID") == str(OWNER_ID), "Repository owner changed")
    require(e.get("GITHUB_EVENT_NAME") == "push", "Only the approved dedicated-branch push is supported")
    require(e.get("GITHUB_REF") == "refs/heads/" + CONTROL_BRANCH, "Use the reviewed dedicated control ref, never main")
    require(e.get("GITHUB_RUN_ATTEMPT") == "1", "A rerun is not a new reviewed session")
    for name in ("GITHUB_SHA", "GITHUB_WORKFLOW_SHA"):
        require(valid_sha(e.get(name)), "Exact workflow commit missing")
    require(e["GITHUB_SHA"] == e["GITHUB_WORKFLOW_SHA"], "Workflow and immutable helper commit differ")
    expected_path = REPOSITORY + "/.github/workflows/qa-batch.yml@" + e["GITHUB_REF"]
    require(e.get("GITHUB_WORKFLOW_REF") == expected_path, "Unexpected workflow path or ref")
    require(re.fullmatch(r"[1-9][0-9]{0,19}", e.get("GITHUB_RUN_ID", "")), "Invalid run ID")
    require(e.get("QA_REPOSITORY_VISIBILITY") == "public", "Public-repository $0 boundary failed")
    return {
        "repository": REPOSITORY,
        "workflowPath": '.github/workflows/qa-batch.yml',
        "workflowCommit": e["GITHUB_SHA"],
        "controlCommit": e["GITHUB_WORKFLOW_SHA"],
        "ref": e["GITHUB_REF"],
        "event": "push",
        "runId": int(e["GITHUB_RUN_ID"]),
        "runAttempt": 1,
        "sessionId": request["session_id"],
    }


def validate_source_metadata(request, repository, pr, commit, timeline_events=None):
    require(repository.get("full_name") == REPOSITORY and repository.get("id") == REPOSITORY_ID, "Own-fork identity mismatch")
    require(repository.get("private") is False and repository.get("fork") is True, "Own fork must remain public")
    require(repository.get("owner", {}).get("login") == OWNER and repository.get("owner", {}).get("id") == OWNER_ID, "Own-fork owner mismatch")
    require(repository.get("parent", {}).get("full_name") == UPSTREAM and repository.get("source", {}).get("full_name") == UPSTREAM, "Unexpected fork parent/network")
    require(pr.get("number") == request["pr"] and pr.get("base", {}).get("repo", {}).get("full_name") == UPSTREAM, "Upstream PR mismatch")
    require(pr.get("user", {}).get("login") == OWNER and pr.get("user", {}).get("id") == OWNER_ID, "PR is not owned by the selected user")
    head_repo = pr.get("head", {}).get("repo") or {}
    require(head_repo.get("full_name") == REPOSITORY and head_repo.get("id") == REPOSITORY_ID, "PR head is not in the owned fork")
    require(head_repo.get("private") is False and head_repo.get("owner", {}).get("id") == OWNER_ID, "PR head owner/visibility mismatch")
    require(pr.get("head", {}).get("sha") == request["head_sha"], "PR head changed since source review")
    direct_merge = pr.get("merge_commit_sha")
    require(direct_merge is None or valid_sha(direct_merge), "Malformed non-null merge commit field")
    if request["source_sha"] == request["head_sha"]:
        kind = "head"
    else:
        require(resolve_merge_sha(pr, timeline_events) == request["source_sha"], "Source is neither current PR head nor its verified merged commit")
        kind = "merge"
    require(commit.get("sha") == request["source_sha"], "Source is unavailable in the owned fork")
    require(commit.get("tree", {}).get("sha") == request["tree_sha"], "Source tree changed or was not reviewed")
    require(kind == "head", "Batch source must remain the current PR head")
    return {"repository": REPOSITORY, "upstreamRepository": UPSTREAM, "pr": request["pr"],
            "sha": request["source_sha"], "headSha": request["head_sha"], "treeSha": request["tree_sha"],
            "kind": kind, "prAuthor": OWNER, "headRepository": REPOSITORY, "headRepositoryId": REPOSITORY_ID}



def resolve_merge_sha(pr, timeline_events=None):
    require(pr.get("merged") is True, "PR is not merged")
    direct = pr.get("merge_commit_sha")
    if direct is not None:
        require(valid_sha(direct), "Malformed non-null merge commit field")
        return direct
    merged_at = pr.get("merged_at")
    require(isinstance(merged_at, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", merged_at), "Missing canonical PR merge timestamp")
    try:
        dt.datetime.strptime(merged_at, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        raise SystemExit("Invalid PR merge timestamp") from None
    require(type(timeline_events) is list and all(type(event) is dict for event in timeline_events), "Complete authoritative timeline required for missing merge SHA")
    matches = [event for event in timeline_events if event.get("event") == "merged"]
    require(len(matches) == 1, "Timeline must contain exactly one merged event")
    event = matches[0]
    event_id = event.get("id")
    require(type(event_id) is int and event_id > 0, "Invalid merged event ID")
    sha = event.get("commit_id")
    require(valid_sha(sha), "Merged event has no valid commit SHA")
    require(event.get("url") == "https://api.github.com/repos/" + UPSTREAM + "/issues/events/" + str(event_id), "Merged event URL does not match upstream")
    require(event.get("commit_url") == "https://api.github.com/repos/" + UPSTREAM + "/commits/" + sha, "Merged commit URL does not match upstream")
    require(event.get("created_at") == merged_at, "Merged event timestamp differs from PR merge timestamp")
    return sha


def timeline_has_next(link, pr_number, page):
    if not link:
        return False
    require(isinstance(link, str), "Malformed timeline pagination header")
    next_links = []
    for part in re.split(r",\s*(?=<)", link):
        match = re.fullmatch(r'\s*<([^>]+)>\s*;\s*rel="(next|prev|first|last)"\s*', part)
        require(match is not None, "Unrecognized timeline pagination header")
        if match.group(2) == "next":
            next_links.append(match.group(1))
    require(len(next_links) <= 1, "Duplicate timeline next-page links")
    if not next_links:
        return False
    try:
        url = urllib.parse.urlsplit(next_links[0])
        query = urllib.parse.parse_qs(url.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        raise SystemExit("Malformed timeline next-page URL") from None
    require(url.scheme == "https" and url.netloc == "api.github.com" and not url.fragment,
            "Timeline next page points outside GitHub API")
    require(url.path == "/repos/" + UPSTREAM + "/issues/" + str(pr_number) + "/timeline",
            "Timeline next page is for another PR")
    require(query == {"per_page": ["100"], "page": [str(page + 1)]}, "Unexpected timeline page size or sequence")
    return True


def fetch_merge_timeline(pr_number):
    require(type(pr_number) is int and 1 <= pr_number <= 9999999, "Invalid timeline PR number")
    events = []
    for page in range(1, 4):
        # Do not follow an arbitrary Link URL. Only increment this fixed public endpoint.
        path = "repos/" + UPSTREAM + "/issues/" + str(pr_number) + "/timeline?per_page=100&page=" + str(page)
        data, headers = github_response(path)
        require(type(data) is list and len(data) <= 100 and all(type(event) is dict for event in data), "Malformed timeline page")
        events.extend(data)
        has_next = timeline_has_next(headers.get("Link", headers.get("link", "")), pr_number, page)
        if len(data) < 100 and not has_next:
            return events
    raise SystemExit("Timeline pagination exceeds the bounded complete-read limit; merge identity is unproven")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def github_response(path, token=None):
    # Fixed service/path family; no user-controlled URLs or token persistence.
    require(path.startswith("repos/"), "Unexpected metadata endpoint")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "owned-fork-static-qa"}
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request("https://api.github.com/" + path, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=25) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            response_headers = dict(response.headers)
        require(len(raw) <= 8 * 1024 * 1024, "Metadata response exceeds limit")
        return json.loads(raw), response_headers
    except (urllib.error.URLError, ValueError, TimeoutError):
        raise SystemExit("GitHub metadata verification failed; no source code was executed") from None


def github_read(path, token=None):
    return github_response(path, token)[0]


def request_path():
    return Path(os.environ["RUNNER_TEMP"]) / "reusable-qa-request.json"


def preflight(control):
    workflow = validate_identity(os.environ)
    request = validate_inputs(os.environ)
    head = subprocess.check_output(["git", "-C", str(control), "rev-parse", "HEAD"]).decode().strip()
    require(head == workflow["controlCommit"], "Helper was not checked out at the immutable workflow commit")
    files = subprocess.check_output(["git", "-C", str(control), "ls-files", "-z"]).decode().split("\0")
    require(set(filter(None, files)) == {'.github/workflows/qa-batch.yml', 'scripts/build_batch.py'}, "Unexpected content in the reviewed control tree")
    # Public metadata only; no new token, secret, or credential flow.
    own = github_read("repos/" + REPOSITORY)
    # Upstream PR metadata is public. Do not grant or assume cross-repository token permissions.
    pr = github_read("repos/" + UPSTREAM + "/pulls/" + str(request["pr"]))
    commit = github_read("repos/" + REPOSITORY + "/git/commits/" + request["source_sha"])
    timeline = None
    if request["source_sha"] != request["head_sha"] and pr.get("merged") is True and pr.get("merge_commit_sha") is None:
        timeline = fetch_merge_timeline(request["pr"])
    source = validate_source_metadata(request, own, pr, commit, timeline)
    write_json(request_path(), {"inputs": request, "source": source, "workflow": workflow})
    print("Owned public-fork PR, immutable source/head/tree, control commit and session verified.")


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate package JSON key")
        result[key] = value
    return result


def parse_package_json(raw):
    def bad_constant(value):
        raise ValueError("Non-finite JSON number")
    try:
        value = json.loads(raw, object_pairs_hook=no_duplicate_keys, parse_constant=bad_constant)
    except (ValueError, UnicodeError):
        raise SystemExit("Invalid package JSON") from None
    require(type(value) is dict, "Package JSON must be an object")
    return value


def canonical_sha256(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode())


def valid_version(value):
    numeric = r"(?:0|[1-9][0-9]*)"
    prerelease = r"(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)"
    pattern = numeric + r"\." + numeric + r"\." + numeric + r"(?:-" + prerelease + r"(?:\." + prerelease + r")*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    return isinstance(value, str) and len(value) <= 64 and re.fullmatch(pattern, value) is not None


def validate_packages(package_raw, lock_raw):
    package = parse_package_json(package_raw)
    lock = parse_package_json(lock_raw)
    version = package.get("version")
    require(valid_version(version), "Package version must be strict SemVer")
    require(type(lock.get("packages")) is dict and type(lock["packages"].get("")) is dict, "Lockfile root package metadata missing")
    require(lock.get("version") == version and lock["packages"][""].get("version") == version, "Package and both lockfile versions must match")
    normalized_package = copy.deepcopy(package)
    normalized_lock = copy.deepcopy(lock)
    normalized_package.pop("version")
    normalized_lock.pop("version")
    normalized_lock["packages"][""].pop("version")
    package_hash = canonical_sha256(normalized_package)
    lock_hash = canonical_sha256(normalized_lock)
    require(package_hash == COMPATIBILITY["packageJsonCanonicalSha256"], "Review required: package scripts, engines, dependencies or metadata changed")
    require(lock_hash == COMPATIBILITY["packageLockCanonicalSha256"], "Review required: dependency lock changed beyond version-only fields")
    return {"packageVersion": version, "packageLockVersion": lock["version"], "packageLockRootVersion": lock["packages"][""]["version"],
            "packageJsonSha256": sha256(package_raw), "dependencyLockSha256": sha256(lock_raw),
            "packageJsonCanonicalSha256": package_hash, "packageLockCanonicalSha256": lock_hash}


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


def source_snapshot(checkout, source):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(checkout), *args]).decode().strip()
    require(git("rev-parse", "HEAD") == source["sha"], "Source checkout SHA mismatch")
    require(not git("status", "--porcelain"), "Source checkout is not clean")
    for name, expected in BLOBS.items():
        require(git("hash-object", name) == expected, "Review required for changed configuration: " + name)
    for name, expected in COMPATIBILITY["trees"].items():
        require(git("rev-parse", "HEAD:" + name) == expected, "Review required for changed executable/configuration tree: " + name)
    for name in COMPATIBILITY["absentPaths"]:
        require(not (checkout / name).exists() and not (checkout / name).is_symlink(), "Review required for alternate configuration file: " + name)
    require(git("rev-parse", "HEAD^{tree}") == source["treeSha"], "Checkout source tree mismatch")
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
    return snapshot


def prepare(checkout):
    request = json.loads(request_path().read_text())
    workflow = validate_identity(os.environ)
    require(request["workflow"] == workflow and request["inputs"] == validate_inputs(os.environ), "Preflight identity changed")
    source = request["source"]
    snapshot = source_snapshot(checkout, source)
    for name, item in snapshot.items():
        require(fingerprint(APP / name) == item, "Source transfer changed tracked bytes")
    pkg = json.loads((APP / "package.json").read_text())
    package_info = validate_packages((APP / "package.json").read_bytes(), (APP / "package-lock.json").read_bytes())
    require(pkg["name"] == "new.expensify", "Package identity changed")
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
        "schemaVersion": 3,
        "artifactName": "qa-static-" + workflow["sessionId"] + "-" + str(workflow["runId"]) + "-1",
        "source": source,
        "compatibility": COMPATIBILITY,
        "workflow": workflow,
        "build": {
            "mode": "development", "command": COMMAND, "nodeVersion": "26.5.0", "npmVersion": "11.17.0", "bunVersion": "1.3.14",
            **package_info, "sourceMap": False, "serviceWorker": False,
            "environmentSha256": sha256(env_bytes()),
            "environment": {"localOrigin": ORIGIN, "backendOrigins": BACKEND_ORIGINS, "variables": ENVIRONMENT},
        },
        "routes": ROUTES,
        "overlays": [overlay],
        "sourceFiles": {name: {"gitBlob": hashlib.sha1(b"blob " + str(len((checkout / name).read_bytes())).encode() + b"\0" + (checkout / name).read_bytes()).hexdigest(), "sha256": sha256((checkout / name).read_bytes())}
                        for name in list(BLOBS) + ["package.json", "package-lock.json"]},
    }
    write_json(STATE / "snapshot.json", snapshot)
    write_json(STATE / "manifest-base.json", data)
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("package_version=" + package_info["packageVersion"] + "\n")
    print("Exact selected PR source, nonsecret loopback environment and HTML-only overlay prepared.")



def discard_verified_install_cache(root, snapshot):
    # Exact pilot module postinstall runs tsc. Its tsconfig sets this cache path,
    # inheriting noEmit:true and incremental:true from tsconfig.base.json.
    # This is disposable compiler metadata, not executable output or source.
    relative = 'modules/ExpensifyNitroUtils/tsconfig.ts7.tsbuildinfo'
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
    manifest = json.loads((STATE / "manifest-base.json").read_text())
    require(json.loads((dist / "version.json").read_text())["version"] == manifest["build"]["packageVersion"], "Generated version does not match source")
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
    print(json.dumps({"artifactName": manifest["artifactName"], "sourceSha": manifest["source"]["sha"],
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
    parser.add_argument("command", choices=("preflight", "prepare", "lock", "finalize", "diagnostics"))
    parser.add_argument("--checkout", type=Path)
    args = parser.parse_args()
    if args.command == "preflight":
        require(args.checkout is not None, "Immutable control checkout required")
        preflight(args.checkout)
    elif args.command == "prepare":
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
