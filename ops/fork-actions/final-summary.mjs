#!/usr/bin/env node

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (typeof file !== "string" || file.length === 0) {
  process.stderr.write("result manifest path is required\n");
  process.exit(1);
}

try {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const checks = manifest?.checks;
  const complete = manifest?.required_progress === "complete" && manifest?.manifest_valid === true && Array.isArray(checks) && checks.length > 0 && checks.every((check) => check?.outcome === "passed" || check?.outcome === "allowed_not_applicable");
  if (!complete) {
    process.stderr.write("Fork CI required-check summary is blocked: every required check must pass or carry an explicit allowed_not_applicable outcome.\n");
    process.exit(1);
  }
  process.stdout.write(`Fork CI required-check summary passed (${checks.length} checks).\n`);
} catch (error) {
  process.stderr.write(`Fork CI result manifest is invalid: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
