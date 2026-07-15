#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Canonical manifest v1 is deliberately small: check identity plus the exact
 * allowed-not-applicable policy. Check commands are protected separately by
 * the trusted workflow-definition SHA.
 */
export function canonicalRequiredCheckManifest(checks) {
  if (!Array.isArray(checks) || checks.length === 0) throw new Error("required checks must be a non-empty array");
  const normalized = checks.map((check) => {
    if (check === null || typeof check !== "object" || Array.isArray(check)) throw new Error("required check must be an object");
    const id = check.id;
    const allowNotApplicable = check.allowNotApplicable ?? check.allow_not_applicable;
    const reason = check.reason ?? check.notApplicableReason ?? check.not_applicable_reason ?? null;
    if (typeof id !== "string" || id.length === 0) throw new Error("required check id is malformed");
    if (typeof allowNotApplicable !== "boolean") throw new Error("required check allow-not-applicable policy is malformed");
    if (allowNotApplicable && (typeof reason !== "string" || reason.trim().length === 0)) throw new Error("allowed not-applicable check requires a reason");
    return {
      id,
      allow_not_applicable: allowNotApplicable,
      not_applicable_reason: allowNotApplicable ? reason.trim() : null
    };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (new Set(normalized.map((check) => check.id)).size !== normalized.length) throw new Error("required check ids must be unique");
  return JSON.stringify({ schema_version: 1, required_checks: normalized });
}

export function requiredCheckManifestHash(checks) {
  return createHash("sha256").update(canonicalRequiredCheckManifest(checks), "utf8").digest("hex");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2];
  if (!source) {
    process.stderr.write("usage: node manifest-hash.mjs <required-checks.json>\n");
    process.exit(1);
  }
  try {
    const checks = JSON.parse(readFileSync(source, "utf8"));
    process.stdout.write(`${requiredCheckManifestHash(checks)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
