import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
// The candidate checker validates packaging/evidence metadata, not model behavior.
// @ts-ignore JavaScript authoring helper has no declaration file.
import { collectSkills, validateSkillFiles, validatePublicProfile } from '../scripts/vendor-workflow-package.mjs';
// @ts-ignore Existing JavaScript evaluation adapter.
import { selectCases } from '../evaluation/skill/project/adapter.mjs';
// @ts-ignore Existing JavaScript project adapter.
import { reviewRequirements } from '../evaluation/skill/project/adapter.mjs';
// @ts-ignore JavaScript review record validator.
import { requirementReview } from '../evaluation/skill/project/requirementReview.mjs';

test('vendor workflow references are self-contained and packageable', async () => {
  const files = await collectSkills();
  assert.ok(files['skills/company-research/references/company-selection.md']);
  assert.ok(files['skills/pca-it-application-assist/references/vendor-workflow.md']);
  assert.ok(Object.keys(files).every(f => /^skills\//.test(f) && !/\.(zip|env|pdf|docx)$/.test(f)));
  assert.throws(() => validateSkillFiles({ ...files, 'skills/pca-it-application-assist/references/vendor-workflow.md': new TextEncoder().encode('[broken](../../../../private.json)') }), /BROKEN_SKILL_REFERENCE/);
});
test('public profile keeps forms, case deadlines, registration and operations unconfirmed', async () => {
  const p = JSON.parse(await fs.readFile('plugins/subsidy-ai/skills/pca-it-application-assist/references/vendors/mimosa.json', 'utf8'));
  validatePublicProfile(p);
  assert.deepEqual(p.applicability.years.value, [2026]); assert.ok(p.applicability.unconfirmedYears.includes(2027));
  assert.equal(p.channels.quote.operationVerified, false); assert.equal(p.channels.quote.embeddedForm.fields, null);
  assert.equal(p.forms[0].original, null); assert.equal(p.forms[0].fieldMap, null);
  assert.equal(p.deadlines.vendor.value, null); assert.equal(p.deadlines.official.value, null);
  assert.ok(Object.values(p.registrationEvidence).every((v: any) => v.value === null && v.status === 'pending'));
  const bad = structuredClone(p); bad.sources.pop(); assert.throws(() => validatePublicProfile(bad), /UNKNOWN_SOURCE/);
  const missing = structuredClone(p); missing.workflowSteps[0].downstream = ['MISSING']; assert.throws(() => validatePublicProfile(missing), /WORKFLOW_DEPENDENCY/);
});
test('V01-V25 map to 24 supplied-text cases and one installed-host gate', async () => {
  const scenarios = JSON.parse(await fs.readFile('evaluation/skill/project/vendor-workflow-scenarios.json', 'utf8'));
  assert.deepEqual(scenarios.map((s: any) => s.id), Array.from({ length: 25 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`));
  const selected = await selectCases({ suite: 'affected', change: 'vendor-workflow' });
  assert.equal(selected.selected.length, 24); assert.ok(!selected.selected.some((c: any) => c.id === 'V24'));
  assert.equal((await selectCases({ suite: 'affected', change: 'common' })).selected.length, 28);
  for (const s of scenarios) {
    if (s.id === 'V24') { assert.equal(s.mode, 'installed_host'); continue; }
    const root = `evaluation/skill/project/cases/${s.id}`;
    const c = JSON.parse(await fs.readFile(`${root}/case.json`, 'utf8')), r = JSON.parse(await fs.readFile(`${root}/rubric.json`, 'utf8'));
    assert.equal(c.id, s.id); assert.equal(c.skill, 'pca-it-application-assist');
    assert.deepEqual(r.required, s.required); assert.deepEqual(r.failures, s.failures);
    assert.deepEqual(r.allowed_sources, ['scenario', 'M01', 'M03']);
    assert.ok((await fs.readFile(`${root}/input/context.txt`, 'utf8')).includes('独立した合成入力'));
  }
});
test('V22 v2 supplies known inputs and explicitly requests all three artifacts', async () => {
  const root = 'evaluation/skill/project/cases/V22';
  const c = JSON.parse(await fs.readFile(`${root}/case.json`, 'utf8')), r = JSON.parse(await fs.readFile(`${root}/rubric.json`, 'utf8'));
  const input = await fs.readFile(`${root}/input/context.txt`, 'utf8'), request = await fs.readFile(`${root}/request.txt`, 'utf8');
  assert.equal(c.version, '2'); assert.equal(r.version, '2');
  for (const known of ['PCAクラウド会計', 'ミモザ', '2026', '承認をメール', '架空見積Q22', '2025年12月期']) assert.ok(input.includes(known));
  for (const artifact of ['手元資料の整理一覧', '現状と導入目標の説明案', '引継ぎメモ']) assert.ok(request.includes(artifact));
  assert.deepEqual(r.required.map((text: string) => text.split(':')[0]), ['R1', 'R2', 'R3', 'R4', 'R5']);
  assert.deepEqual(reviewRequirements('V22'), ['correctness', 'scope', 'evidence', 'R1', 'R2', 'R3', 'R4', 'R5']);
  assert.deepEqual(reviewRequirements('C001'), ['correctness', 'scope', 'evidence']);
});
test('requirement reviews reject missing judgments and fabricated evidence', () => {
  const required = ['R1: inventory', 'R2: draft', 'R3: handoff'];
  const response = 'inventory text; draft text; handoff text';
  const decisions = ['inventory text', 'draft text', 'handoff text'].map((q, i) => ({ id: `R${i + 1}`, status: 'PASS', reason: 'Explicit fixture judgment, not a semantic evaluation', excerpts: [q] }));
  assert.equal(requirementReview(required, response, decisions).status, 'PASS');
  assert.throws(() => requirementReview(required, response, decisions.slice(0, 2)), /INCOMPLETE/);
  assert.throws(() => requirementReview(required, response, [...decisions.slice(0, 2), { ...decisions[2], excerpts: ['invented quote'] }]), /EVIDENCE_INVALID/);
  assert.throws(() => requirementReview(required, response, [...decisions.slice(0, 2), { ...decisions[2], excerpts: [] }]), /EVIDENCE_INVALID/);
  assert.equal(requirementReview(required, response, [...decisions.slice(0, 2), { ...decisions[2], status: 'FAIL' }]).status, 'FAIL');
});
