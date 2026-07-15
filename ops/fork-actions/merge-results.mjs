#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { requiredCheckManifestHash } from "./manifest-hash.mjs";

const MAX_INPUT_BYTES = 32 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const ACCEPTABLE_OUTCOMES = new Set(["passed", "allowed_not_applicable"]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set(["--input", "--results", "--output"]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || index + 1 >= argv.length || values.has(key)) fail("expected unique --input, --results, and --output arguments");
    values.set(key, argv[index + 1]);
    index += 1;
  }
  for (const key of allowed) if (!values.has(key)) fail(`missing ${key}`);
  return values;
}

function readJson(file, maximum) {
  const raw = readFileSync(file);
  if (raw.byteLength > maximum) fail(`${path.basename(file)} exceeds its bounded size`);
  return JSON.parse(raw.toString("utf8"));
}

function resultFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
    }
  };
  if (!statSync(directory).isDirectory()) fail("results path must be a directory");
  visit(directory);
  return files.sort();
}

function expectedIdentity(payload) {
  return {
    schema_version: payload.schema_version,
    dispatch_tag: payload.dispatch_tag,
    repository_id: payload.repository_id,
    workflow_id: payload.workflow_id,
    workflow_path: payload.workflow_path,
    workflow_ref: payload.workflow_ref,
    workflow_definition_sha: payload.workflow_definition_sha,
    job_id: payload.job_id,
    job_attempt_id: payload.job_attempt_id,
    attempt_number: payload.attempt_number,
    tested_branch: payload.tested_branch,
    tested_head_sha: payload.tested_head_sha,
    base_sha: payload.base_sha,
    required_manifest_hash: payload.required_manifest_hash
  };
}

function validatePartial(partial, identity, requiredChecks) {
  if (partial === null || typeof partial !== "object" || Array.isArray(partial)) fail("partial result must be an object");
  for (const [key, expected] of Object.entries(identity)) {
    if (partial[key] !== expected) fail(`partial result identity mismatch: ${key}`);
  }
  if (partial.partial_manifest !== true || partial.required_progress !== "pending") fail("result is not a pending partial manifest");
  if (!Array.isArray(partial.checks) || partial.checks.length !== 1) fail("partial manifest must contain exactly one check");
  const check = partial.checks[0];
  if (check === null || typeof check !== "object" || !requiredChecks.has(check.id)) fail("partial manifest contains an unknown check");
  if (check.identity !== check.id || check.name !== check.label) fail("partial check identity aliases disagree");
  if (!new Set(["passed", "failed", "allowed_not_applicable"]).has(check.outcome)) fail("partial check outcome is malformed");
  const policy = requiredChecks.get(check.id);
  if (check.outcome === "allowed_not_applicable" && (!policy.allowNotApplicable || check.allowedNotApplicableReason !== policy.reason)) fail("partial check violates the not-applicable policy");
  if (partial.manifest_valid !== ACCEPTABLE_OUTCOMES.has(check.outcome)) fail("partial manifest validity disagrees with its check outcome");
  return check;
}

function syntheticFailure(id, reason) {
  return {
    id,
    identity: id,
    label: id,
    name: id,
    outcome: "failed",
    reason,
    allowedNotApplicableReason: null,
    startedAt: null,
    completedAt: new Date().toISOString(),
    exitCode: null,
    diagnostics: ""
  };
}

function writeManifest(file, manifest) {
  const body = JSON.stringify(manifest, null, 2);
  if (Buffer.byteLength(body) > MAX_ARTIFACT_BYTES) fail("merged result manifest exceeds its bounded size");
  writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = path.resolve(args.get("--input"));
  const results = path.resolve(args.get("--results"));
  const output = path.resolve(args.get("--output"));
  const payload = readJson(input, MAX_INPUT_BYTES);
  if (!Array.isArray(payload.required_checks) || payload.required_checks.length === 0) fail("request required_checks is malformed");
  const normalizedChecks = payload.required_checks.map((check) => ({
    id: check.id,
    allowNotApplicable: check.allow_not_applicable,
    reason: check.not_applicable_reason ?? null
  }));
  if (requiredCheckManifestHash(normalizedChecks) !== payload.required_manifest_hash) fail("request manifest hash is invalid");
  const requiredChecks = new Map(normalizedChecks.map((check) => [check.id, check]));
  const requiredIds = new Set(requiredChecks.keys());
  if (requiredChecks.size !== normalizedChecks.length) fail("request contains duplicate check identities");
  const identity = expectedIdentity(payload);
  const candidates = new Map([...requiredIds].map((id) => [id, []]));
  const mergeErrors = [];
  for (const file of resultFiles(results)) {
    try {
      const check = validatePartial(readJson(file, MAX_RESULT_BYTES), identity, requiredChecks);
      candidates.get(check.id).push(check);
    } catch (error) {
      mergeErrors.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const checks = normalizedChecks.map(({ id }) => {
    const matches = candidates.get(id);
    if (matches.length === 1) return matches[0];
    return syntheticFailure(id, matches.length === 0 ? "Required parallel check evidence is missing." : "Required parallel check evidence is ambiguous.");
  });
  const allAcceptable = mergeErrors.length === 0 && checks.every((check) => ACCEPTABLE_OUTCOMES.has(check.outcome));
  const manifest = {
    schema_version: payload.schema_version,
    schemaVersion: payload.schema_version,
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
    required_progress: "complete",
    manifest_valid: allAcceptable,
    merge_errors: mergeErrors,
    diagnostic_artifact_references: [],
    generated_at: new Date().toISOString(),
    manifest_digest: createHash("sha256").update(JSON.stringify({ ...identity, checks, mergeErrors })).digest("hex")
  };
  writeManifest(output, manifest);
  if (!allAcceptable) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
