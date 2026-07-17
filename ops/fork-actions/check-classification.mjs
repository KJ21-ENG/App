const INFRASTRUCTURE_EXIT_CODES = new Set([126, 127, 134, 137]);

export function classifyCommandFailure({status, timedOut = false, spawnErrorCode = null} = {}) {
  if (timedOut || status === null || status === undefined || spawnErrorCode !== null || INFRASTRUCTURE_EXIT_CODES.has(status)) {
    return "infrastructure";
  }
  return "code";
}

export function failureEvidenceForCheck(id, result) {
  const classification = classifyCommandFailure(result);
  if (result.timedOut) {
    return { failureClassification: classification, failureEvidence: [{ message: `${id} exceeded the trusted workflow timeout.` }] };
  }
  if (result.spawnErrorCode !== null && result.spawnErrorCode !== undefined) {
    return { failureClassification: classification, failureEvidence: [{ message: `${id} could not start (${result.spawnErrorCode}).` }] };
  }
  if (result.status === null || result.status === undefined) {
    return { failureClassification: classification, failureEvidence: [{ message: `${id} ended without an exit status.` }] };
  }
  if (INFRASTRUCTURE_EXIT_CODES.has(result.status)) {
    return { failureClassification: classification, failureEvidence: [{ message: `${id} could not execute a required command (exit ${result.status}).` }] };
  }
  return { failureClassification: classification, failureEvidence: [{ message: `${id} reported target-code diagnostics (exit ${result.status}).` }] };
}
