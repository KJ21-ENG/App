import assert from "node:assert/strict";
import test from "node:test";

import { classifyCommandFailure, failureEvidenceForCheck } from "./check-classification.mjs";

test("normal nonzero check exits are target-code failures", () => {
  assert.equal(classifyCommandFailure({ status: 1 }), "code");
  assert.deepEqual(failureEvidenceForCheck("typecheck", { status: 2 }), {
    failureClassification: "code",
    failureEvidence: [{ message: "typecheck reported target-code diagnostics (exit 2)." }]
  });
});

test("startup, command, and timeout failures are infrastructure", () => {
  assert.equal(classifyCommandFailure({ status: 127 }), "infrastructure");
  assert.equal(classifyCommandFailure({ status: 137 }), "infrastructure");
  assert.equal(classifyCommandFailure({ status: null, spawnErrorCode: "ENOENT" }), "infrastructure");
  assert.equal(classifyCommandFailure({ status: null, timedOut: true }), "infrastructure");
});
