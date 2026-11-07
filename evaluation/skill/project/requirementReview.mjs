/** Validate a reviewer's explicit per-requirement judgments, not the answer's semantics. */
export function requirementReview(required, response, decisions) {
  const ids = required.map(text => /^([A-Z]+\d+):/.exec(text)?.[1]);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw Error('REQUIREMENT_IDS_REQUIRED');
  if (!Array.isArray(decisions) || decisions.length !== ids.length || new Set(decisions.map(d => d.id)).size !== ids.length || decisions.some(d => !ids.includes(d.id))) throw Error('REQUIREMENT_REVIEW_INCOMPLETE');
  for (const d of decisions) {
    if (!['PASS', 'FAIL'].includes(d.status) || !d.reason?.trim() || !Array.isArray(d.excerpts) || !d.excerpts.length || d.excerpts.some(q => typeof q !== 'string' || !q.trim() || !response.includes(q))) throw Error(`REQUIREMENT_EVIDENCE_INVALID: ${d.id}`);
  }
  return { status: decisions.some(d => d.status === 'FAIL') ? 'FAIL' : 'PASS',
    checks: Object.fromEntries(decisions.map(d => [d.id, d.status])),
    evidence: decisions.flatMap(d => d.excerpts.map(q => `${d.id}: ${q}`)), decisions };
}
