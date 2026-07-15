#!/usr/bin/env node

/**
 * The only command runner used by seatbelt-fork-checks.yml.
 *
 * The dispatch payload is an identity envelope, not a shell command. Every
 * check below is an allowlisted argv array. Tested code is run with a small
 * environment and never receives GITHUB_TOKEN or repository secrets.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

import { requiredCheckManifestHash } from "./manifest-hash.mjs";

const SCHEMA_VERSION = 1;
const MAX_INPUT_BYTES = 32 * 1024;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const SHA = /^[a-fA-F0-9]{40}$/u;
const SHA256 = /^[a-fA-F0-9]{64}$/u;
const CHECK_IDS = new Set(["typecheck", "lint", "format", "react-compiler", "jest"]);
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,255}$/u;
const SAFE_TAG = /^[A-Za-z0-9._:-]{16,160}$/u;
const SAFE_PATH = /^[A-Za-z0-9._/@+-]+$/u;

const CHECKS = {
  typecheck: { label: "Full typecheck", command: ["npm", "run", "typecheck"] },
  lint: { label: "Exact changed-file lint", command: ["./scripts/lint.sh"] },
  format: { label: "Formatting policy", command: ["npm", "run", "fmt"] },
  "react-compiler": { label: "Changed-file React Compiler compliance", command: ["npm", "run", "react-compiler-compliance-check", "--", "check"] },
  jest: { label: "Validated targeted Jest", command: ["npm", "run", "test", "--", "--runInBand"] }
};

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, field, pattern, max = 255) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || (pattern && !pattern.test(value))) {
    fail(`${field} is malformed`);
  }
  return value;
}

function requireSha(value, field) {
  return requireString(value, field, SHA, 40);
}

function boundedText(value, max = MAX_DIAGNOSTIC_BYTES) {
  const text = String(value ?? "");
  const redacted = text
    .replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|x-access-token:[^\s/]+|Bearer\s+[A-Za-z0-9._-]+)/giu, "[REDACTED]")
    .replace(/(["']?(?:token|password|secret|authorization)["']?\s*[:=]\s*["']?)[^\s,"']+/giu, "$1[REDACTED]");
  return redacted.length <= max ? redacted : `${redacted.slice(-max)}\n[bounded tail]`;
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set(["--input", "--repo", "--output", "--check"]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || index + 1 >= argv.length || values.has(key)) fail("expected unique --input, --repo, --output, and optional --check arguments");
    values.set(key, argv[index + 1]);
    index += 1;
  }
  for (const key of ["--input", "--repo", "--output"]) if (!values.has(key)) fail(`missing ${key}`);
  return values;
}

function readPayload(inputPath) {
  const raw = readFileSync(inputPath);
  if (raw.byteLength > MAX_INPUT_BYTES) fail("dispatch payload exceeds the bounded input size");
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("dispatch payload is not valid JSON");
  }
  if (!isObject(value)) fail("dispatch payload must be an object");
  const payload = value;
  if (payload.schema_version !== SCHEMA_VERSION) fail("unsupported dispatch payload schema");
  requireString(payload.repository_id, "repository_id", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u, 200);
  requireString(payload.workflow_id, "workflow_id", /^[A-Za-z0-9_.-]+$/u, 128);
  requireString(payload.workflow_path, "workflow_path", /^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/u, 255);
  if (payload.workflow_path.includes("..")) fail("workflow_path may not contain parent traversal");
  requireString(payload.workflow_ref, "workflow_ref", SAFE_BRANCH);
  requireSha(payload.workflow_definition_sha, "workflow_definition_sha");
  requireString(payload.dispatch_tag, "dispatch_tag", SAFE_TAG);
  requireString(payload.tested_branch, "tested_branch", SAFE_BRANCH);
  requireSha(payload.tested_head_sha, "tested_head_sha");
  requireSha(payload.base_sha, "base_sha");
  requireString(payload.required_manifest_hash, "required_manifest_hash", SHA256, 64);
  if (!Number.isSafeInteger(payload.job_id) || payload.job_id < 1 || payload.job_id > 2_147_483_647) fail("job_id is malformed");
  if (!Number.isSafeInteger(payload.job_attempt_id) || payload.job_attempt_id < 1 || payload.job_attempt_id > 2_147_483_647) fail("job_attempt_id is malformed");
  if (!Number.isSafeInteger(payload.attempt_number) || payload.attempt_number < 1 || payload.attempt_number > 100) fail("attempt_number is malformed");
  if (!Array.isArray(payload.required_checks) || payload.required_checks.length < 1 || payload.required_checks.length > CHECK_IDS.size) fail("required_checks must be a bounded non-empty array");
  const checks = [];
  const identities = new Set();
  for (const item of payload.required_checks) {
    const check = typeof item === "string" ? { id: item, allow_not_applicable: false } : item;
    if (!isObject(check)) fail("required_checks entries must be structured objects");
    requireString(check.id, "required_checks.id", null, 40);
    if (!CHECK_IDS.has(check.id) || identities.has(check.id)) fail("required_checks contains an unknown or duplicate check id");
    identities.add(check.id);
    if (typeof check.allow_not_applicable !== "boolean") fail("required_checks.allow_not_applicable must be boolean");
    const reason = check.not_applicable_reason;
    if (check.allow_not_applicable && (typeof reason !== "string" || reason.trim().length === 0 || reason.length > 512)) fail("allowed not-applicable checks require a bounded reason");
    checks.push({ id: check.id, allowNotApplicable: check.allow_not_applicable, reason: typeof reason === "string" ? reason : null });
  }
  const targetJestFiles = payload.target_jest_files ?? [];
  if (!Array.isArray(targetJestFiles) || targetJestFiles.length > 32) fail("target_jest_files must be a bounded array");
  for (const file of targetJestFiles) {
    requireString(file, "target_jest_files", SAFE_PATH, 240);
    if (file.startsWith("/") || file.includes("..") || file.startsWith(".git/") || file.startsWith("node_modules/")) fail("target_jest_files contains an unsafe path");
  }
  return { ...payload, checks, targetJestFiles };
}

function safeEnvironment(repoPath) {
  const allowed = ["PATH", "USER", "LANG", "LC_ALL"];
  const isolatedHome = process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, "seatbelt-fork-home") : null;
  if (isolatedHome) mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
  const environment = { CI: "true", GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: repoPath, NPM_CONFIG_USERCONFIG: "/dev/null" };
  if (isolatedHome) environment.HOME = isolatedHome;
  for (const name of allowed) if (typeof process.env[name] === "string") environment[name] = process.env[name];
  return environment;
}

function changedFiles(repoPath, baseSha, headSha, options = {}) {
  const diffArgs = ["-C", repoPath, "diff", "--diff-filter=AMR", "--name-only", "-z"];
  diffArgs.push(`${baseSha}..${headSha}`);
  if (options.pathspecs?.length) diffArgs.push("--", ...options.pathspecs);
  const result = spawnSync("git", diffArgs, { encoding: "buffer", timeout: 30_000, maxBuffer: 256 * 1024 });
  if (result.error || result.status !== 0) {
    const diagnostic = result.stderr?.length ? result.stderr : result.error;
    fail(`could not inspect exact base-to-head diff: ${boundedText(diagnostic)}`);
  }
  return result.stdout.toString("utf8").split("\0").filter(Boolean);
}

const LINTABLE_PATHS = ["*.js", "*.jsx", "*.ts", "*.tsx", "*.mjs", "*.cjs"];

function lintableFiles(repoPath, baseSha, headSha) {
  return changedFiles(repoPath, baseSha, headSha, { pathspecs: LINTABLE_PATHS });
}

function appendDiagnostic(previous, chunk) {
  return boundedText(`${previous}${String(chunk)}`);
}

function runCommand(command, args, options) {
  return new Promise((resolve) => {
    let diagnostics = "";
    let settled = false;
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const capture = (stream, destination) => {
      stream.on("data", (chunk) => {
        diagnostics = appendDiagnostic(diagnostics, chunk);
        if (!destination.write(chunk)) {
          stream.pause();
          destination.once("drain", () => stream.resume());
        }
      });
    };
    capture(child.stdout, process.stdout);
    capture(child.stderr, process.stderr);
    const timeout = setTimeout(() => child.kill("SIGTERM"), 2 * 60 * 60 * 1000);
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) diagnostics = appendDiagnostic(diagnostics, `\n${error.message}`);
      resolve({ status, diagnostics });
    };
    child.once("error", (error) => finish(null, error));
    child.once("close", (status) => finish(status));
  });
}

async function runCheck(id, payload, repoPath, changed) {
  const spec = CHECKS[id];
  if (!spec) fail(`check ${id} is not allowlisted`);
  const configured = payload.checks.find((item) => item.id === id);
  const startedAt = new Date().toISOString();
  if (id === "react-compiler" && !changed.some((file) => /\.(?:tsx?)$/u.test(file))) {
    if (!configured.allowNotApplicable) return { id, label: spec.label, outcome: "failed", reason: "No React files changed but policy did not allow not-applicable.", startedAt, completedAt: new Date().toISOString(), exitCode: null, diagnostics: "" };
    return { id, label: spec.label, outcome: "allowed_not_applicable", reason: configured.reason, startedAt, completedAt: new Date().toISOString(), exitCode: 0, diagnostics: "" };
  }
  if (id === "jest" && payload.targetJestFiles.length === 0) {
    if (!configured.allowNotApplicable) return { id, label: spec.label, outcome: "failed", reason: "No validated target test list but policy did not allow not-applicable.", startedAt, completedAt: new Date().toISOString(), exitCode: null, diagnostics: "" };
    return { id, label: spec.label, outcome: "allowed_not_applicable", reason: configured.reason, startedAt, completedAt: new Date().toISOString(), exitCode: 0, diagnostics: "" };
  }
  if (id === "lint" && changed.length === 0) {
    const diagnostic = "No lintable AMR files changed in the exact base-to-tested diff; lint passed without invoking ESLint.";
    return { id, label: spec.label, outcome: "passed", reason: null, startedAt, completedAt: new Date().toISOString(), exitCode: 0, diagnostics: boundedText(diagnostic) };
  }
  const args = id === "jest"
    ? [...spec.command, ...payload.targetJestFiles]
    : id === "lint"
      ? [...spec.command, ...changed.map((file) => `./${file}`)]
    : id === "react-compiler"
      ? [...spec.command, ...changed.filter((file) => /\.(?:tsx?)$/u.test(file))]
      : spec.command;
  let result = await runCommand(args[0], args.slice(1), {
    cwd: repoPath,
    env: safeEnvironment(repoPath),
    windowsHide: true
  });
  if (id === "lint" && result.status !== 0) {
    process.stdout.write("Lint failed; clearing the ESLint cache and retrying once, matching upstream CI.\n");
    rmSync(path.join(repoPath, "node_modules", ".cache", "eslint"), { recursive: true, force: true });
    const retry = await runCommand(args[0], args.slice(1), {
      cwd: repoPath,
      env: safeEnvironment(repoPath),
      windowsHide: true
    });
    result = { status: retry.status, diagnostics: appendDiagnostic(result.diagnostics, `\n[retry after ESLint cache clear]\n${retry.diagnostics}`) };
  }
  if (id === "format" && result.status === 0) {
    const diff = await runCommand("git", ["diff", "--name-only", "--exit-code"], {
      cwd: repoPath,
      env: safeEnvironment(repoPath),
      windowsHide: true
    });
    result = { status: diff.status, diagnostics: appendDiagnostic(result.diagnostics, `\n[post-format git diff]\n${diff.diagnostics}`) };
  }
  return {
    id,
    label: spec.label,
    outcome: result.status === 0 ? "passed" : "failed",
    reason: result.status === 0 ? null : "The allowlisted check command failed.",
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: typeof result.status === "number" ? result.status : null,
    diagnostics: boundedText(result.diagnostics)
  };
}

function validateIdentity(payload, repoPath) {
  const actualRepository = process.env.GITHUB_REPOSITORY;
  if (actualRepository && actualRepository !== payload.repository_id) fail("dispatch repository does not match the workflow repository");
  const actualWorkflowSha = process.env.TRUSTED_WORKFLOW_SHA || process.env.GITHUB_WORKFLOW_SHA;
  if (actualWorkflowSha && actualWorkflowSha !== payload.workflow_definition_sha) fail("workflow definition SHA drifted from the trusted configuration");
  const actualWorkflowRef = process.env.TRUSTED_WORKFLOW_REF || process.env.GITHUB_REF;
  if (actualWorkflowRef) {
    const normalized = actualWorkflowRef.replace(/^refs\/(?:heads|tags)\//u, "");
    if (normalized !== payload.workflow_ref) fail("workflow ref drifted from the trusted configuration");
  }
  const head = spawnSync("git", ["-C", repoPath, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 30_000 });
  if (head.error || head.status !== 0 || head.stdout.trim() !== payload.tested_head_sha) fail("checked out HEAD does not equal the requested tested SHA");
}

function writeManifest(outputPath, manifest) {
  let body = JSON.stringify(manifest, null, 2);
  if (Buffer.byteLength(body) > MAX_ARTIFACT_BYTES) {
    const boundedChecks = manifest.checks.map((check) => ({ ...check, diagnostics: boundedText(check.diagnostics, 8 * 1024) }));
    body = JSON.stringify({ ...manifest, checks: boundedChecks, artifact_bounded: true }, null, 2);
  }
  if (Buffer.byteLength(body) > MAX_ARTIFACT_BYTES) body = body.slice(0, MAX_ARTIFACT_BYTES - 32) + "\n[truncated artifact]\n";
  writeFileSync(outputPath, body, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.get("--input"));
  const repoPath = path.resolve(args.get("--repo"));
  const outputPath = path.resolve(args.get("--output"));
  const payload = readPayload(inputPath);
  const selectedCheck = args.get("--check");
  if (selectedCheck && !payload.checks.some((check) => check.id === selectedCheck)) fail("selected check is not present in required_checks");
  const computedManifestHash = requiredCheckManifestHash(payload.checks);
  if (computedManifestHash !== payload.required_manifest_hash.toLowerCase()) {
    fail("required_manifest_hash does not match the canonical required_checks policy");
  }
  validateIdentity(payload, repoPath);
  const requestedChecks = selectedCheck ? payload.checks.filter((check) => check.id === selectedCheck) : payload.checks;
  const changed = !selectedCheck || selectedCheck === "react-compiler"
    ? changedFiles(repoPath, payload.base_sha, payload.tested_head_sha)
    : [];
  const lintChanged = !selectedCheck || selectedCheck === "lint"
    ? lintableFiles(repoPath, payload.base_sha, payload.tested_head_sha)
    : [];
  const rawChecks = await Promise.all(requestedChecks.map((check) => runCheck(check.id, payload, repoPath, check.id === "lint" ? lintChanged : changed)));
  const checks = rawChecks.map((check) => ({
    ...check,
    identity: check.id,
    name: check.label,
    allowedNotApplicableReason: check.outcome === "allowed_not_applicable" ? check.reason : null
  }));
  const allAcceptable = checks.length === requestedChecks.length && checks.every((check) => check.outcome === "passed" || check.outcome === "allowed_not_applicable");
  const manifest = {
    schema_version: SCHEMA_VERSION,
    schemaVersion: SCHEMA_VERSION,
    dispatch_tag: payload.dispatch_tag,
    dispatchTag: payload.dispatch_tag,
    repository_id: payload.repository_id,
    repositoryId: payload.repository_id,
    workflow_id: payload.workflow_id,
    workflowId: payload.workflow_id,
    workflow_path: payload.workflow_path,
    workflowPath: payload.workflow_path,
    workflow_ref: payload.workflow_ref,
    workflowRef: payload.workflow_ref,
    workflow_definition_sha: payload.workflow_definition_sha,
    workflowDefinitionSha: payload.workflow_definition_sha,
    observed_workflow_ref: process.env.TRUSTED_WORKFLOW_REF || process.env.GITHUB_WORKFLOW_REF || null,
    observed_workflow_sha: process.env.TRUSTED_WORKFLOW_SHA || process.env.GITHUB_WORKFLOW_SHA || null,
    event: "workflow_dispatch",
    eventKind: "workflow_dispatch",
    job_id: payload.job_id,
    job_attempt_id: payload.job_attempt_id,
    attempt_number: payload.attempt_number,
    tested_branch: payload.tested_branch,
    testedBranch: payload.tested_branch,
    tested_head_sha: payload.tested_head_sha,
    testedHeadSha: payload.tested_head_sha,
    checked_out_head_sha: payload.tested_head_sha,
    base_sha: payload.base_sha,
    baseSha: payload.base_sha,
    required_manifest_hash: payload.required_manifest_hash,
    manifestHash: payload.required_manifest_hash,
    requiredChecks: checks,
    checks,
    required_progress: selectedCheck ? "pending" : "complete",
    manifest_valid: allAcceptable,
    partial_manifest: Boolean(selectedCheck),
    diagnostic_artifact_references: [],
    generated_at: new Date().toISOString(),
    manifest_digest: createHash("sha256").update(JSON.stringify({ ...payload, checks })).digest("hex")
  };
  writeManifest(outputPath, manifest);
  if (!allAcceptable) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
