import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft } from '../../src/applicationAssist/draft';
import { caseSchema, type AssistCase, type FieldEvidence } from '../../src/applicationAssist/schema';
import { requiredFacts, reviseCase, validateCase, reviewSnapshot } from '../../src/applicationAssist/engine';
import { generatePackage } from '../../src/applicationAssist/output';
import { normalizeAmount, timeSaving, productivity, growth, compound, quote } from '../../src/applicationAssist/calculations';
import { groundedSentences } from '../../src/applicationAssist/narrative';
import { enrichCompany } from '../../src/applicationAssist/company';
import { NtaApiError } from '../../src/nta';
import { GBizInfoApiError } from '../../src/gbizinfo';
import { transcriptionValue } from '../../src/applicationAssist/transcription';

const sha = 'a'.repeat(64), now = '2026-11-07T01:00:00Z';
const ref = { url: 'https://example.org/synthetic-only', sha256: sha, retrievedAt: now, revisedAt: '2026-11-07', page: 1 };
function complete(): AssistCase {
  const c = createDraft('TEST-INDEPENDENT', 'TEST-COMPANY', 'synthetic_test', '2026-11-07');
  c.scope.requestedGrantYen = 100_000; c.scope.priorGrant = false;
  c.rulePack.verified = true; c.rulePack.testOnly = true; c.rulePack.reviewer = 'test'; c.rulePack.references = [ref];
  c.requiredPeriods = { latest: '2026-06-30', productivity: '2025-06-30', wages: '2024-06-30', ruleVersion: c.rulePack.version };
  c.product = { ...c.product, name: 'Synthetic accounting tool', plan: 'TEST', toolNumber: 'TEST-001', vendorNumber: 'TEST-VENDOR',
    verified: true, testOnly: true, registrationReference: ref, featureReferences: [ref] };
  c.sources.push({ sourceId: 'synthetic-source', caseId: c.caseId, companyId: c.companyId, path: '/synthetic/no-real-document.pdf',
    sha256: sha, url: null, pageCount: 10, kind: 'pdf', visibility: 'vendorShareable' });
  const values: Record<string, FieldEvidence['value']> = { corporateNumber: '9999999999999', companyName: 'Synthetic Example', location: 'Synthetic City',
    capitalStockYen: 10_000, employeeNumber: 2, assets: 100, liabilities: 40, netAssets: 60, sales: 1000, costOfSales: 200, grossProfit: 800,
    sellingGeneralAdministrative: 300, operatingProfit: 500, personnelCosts: 200, depreciation: 50, annualTotalHours: 10, wageTotal: 100,
    businessSummary: 'Synthetic business', improvementPlan: 'Reviewed plan', productivityPlan: 'Reviewed productivity plan', wagePlan: 'Reviewed wage plan',
    quoteConfirmed: true, eligibilityConfirmed: true, gbizIdReady: true, securityActionReady: true, priorGrantChecked: true,
    periodStart: '2025-07-01', periodEnd: '2026-06-30' };
  c.fields = Object.entries(values).map(([fieldId, value]) => ({ fieldId, caseId: c.caseId, companyId: c.companyId, value,
    unit: typeof value === 'number' ? fieldId === 'employeeNumber' ? 'persons' : fieldId === 'annualTotalHours' ? 'hours' : 'JPY' : null,
    periodStart: null, periodEnd: fieldId === 'wageTotal' ? '2024-06-30' : ['operatingProfit', 'personnelCosts', 'depreciation', 'annualTotalHours'].includes(fieldId) ? '2025-06-30' : '2026-06-30', asOfDate: null,
    state: 'verified', sourceId: 'synthetic-source', fileSha256: sha, url: null, page: 1, bounds: null,
    originalLabel: fieldId === 'operatingProfit' ? '営業利益' : fieldId === 'grossProfit' ? '売上総利益' : fieldId,
    originalText: String(value), retrievedAt: null, sourceUpdatedAt: null, method: 'document', calculation: null,
    reviewer: 'test', reviewedAt: now, evidenceVersion: 'test-v1', originalChecked: true, applicantConfirmed: true, visibility: 'vendorShareable' }));
  // BS/PL identities compare equal fiscal periods; productivity uses a separately supplied past-year field below.
  c.fields.find(f => f.fieldId === 'operatingProfit')!.periodEnd = '2026-06-30';
  c.requiredPeriods.productivity = '2026-06-30';
  for (const id of ['personnelCosts', 'depreciation', 'annualTotalHours']) c.fields.find(f => f.fieldId === id)!.periodEnd = '2026-06-30';
  c.fieldMap = { version: 'test-map', complete: true, testOnly: true, fields: requiredFacts.map((fieldId, order) => ({
    fieldId, order, screenId: 'TEST-SCREEN', officialLabel: `Synthetic ${fieldId}`, actor: 'applicant', inputType: 'text', requiredWhen: 'always',
    unit: c.fields.find(f => f.fieldId === fieldId)!.unit, rounding: 'exact', maxLength: null, choices: [], reference: ref, manualChecked: true, screenCheckedAt: '2026-11-07' })) };
  c.requiredAttachmentIds = ['TEST-ATTACHMENT'];
  c.attachments = [{ attachmentId: 'TEST-ATTACHMENT', sourceId: 'synthetic-source', screenId: 'TEST-SCREEN', officialLabel: 'Synthetic attachment', required: true,
    periodEnd: '2026-06-30', expectedPeriodEnd: '2026-06-30', expiresAt: '2026-12-01', format: 'pdf', bytes: 100, maxBytes: 1000,
    verified: true, mappingVersion: 'test-map', visibility: 'applicantOnly' }];
  c.apiChecks = [{ provider: 'nta', checkedAt: now, checkedOn: null, status: 'matched', code: null, addressImageId: null, addressImageVerified: false, notice: 'test', sourceUrl: ref.url }];
  c.projectionPeriods = ['2028-06-30', '2029-06-30', '2030-06-30'];
  for (const [index, periodEnd] of c.projectionPeriods.entries()) for (const id of ['operatingProfit', 'personnelCosts', 'depreciation', 'annualTotalHours']) {
    const original = c.fields.find(f => f.fieldId === id)!;
    c.fields.push({ ...original, fieldId: `plan.${index + 1}.${id}`, periodEnd,
      value: id === 'operatingProfit' ? 500 + 50 * (index + 1) : original.value });
  }
  c.review = { reviewer: 'test', reviewedAt: now, revision: 1, inputSnapshot: reviewSnapshot(c) };
  return c;
}
const field = (c: AssistCase, id: string) => c.fields.find(f => f.fieldId === id)!;
test('P1 JPY to thousand JPY copies 1 for 1000 yen for both roles with provenance', () => {
  for (const actor of ['applicant', 'vendor'] as const) {
    const c = complete(), m = c.fieldMap.fields.find(m => m.fieldId === 'sales')!;
    m.unit = '千円'; m.inputType = 'number'; m.actor = actor;
    c.review!.inputSnapshot = reviewSnapshot(c);
    const b = generatePackage(c), r = b.fieldValues[actor].find(r => r.officialLabel === m.officialLabel)!;
    assert.equal(b.report.state, 'readyForTranscription'); assert.equal(r.value, 1); assert.equal(r.candidate, 1); assert.equal(r.copyable, true);
    assert.equal(r.sourceValue, 1000); assert.equal(r.sourceUnit, 'JPY'); assert.equal(r.unit, '千円');
    assert.deepEqual(r.conversion, { formula: 'source / 1000', rounding: 'exact', rawValue: 1, targetUnit: '千円', fieldMapVersion: 'test-map' });
    const html = actor === 'applicant' ? b.applicantHtml : b.vendorHtml;
    assert.match(html, /<pre id="value-\d+">1<\/pre>/);
  }
});
test('P1 same units preserve values, including reviewed fractional hours', () => {
  const c = complete(); field(c, 'annualTotalHours').value = 10.5; c.review!.inputSnapshot = reviewSnapshot(c);
  const b = generatePackage(c); assert.equal(b.report.state, 'readyForTranscription');
  assert.equal(b.fieldValues.applicant.find(r => r.officialLabel === 'Synthetic sales')!.value, 1000);
  assert.equal(b.fieldValues.applicant.find(r => r.officialLabel === 'Synthetic annualTotalHours')!.value, 10.5);
});
test('P1 unsupported, missing and incompatible units block copy and readiness after review', () => {
  for (const unit of ['USD', 'hours', null]) {
    const c = complete(); c.fieldMap.fields.find(m => m.fieldId === 'sales')!.unit = unit; c.review!.inputSnapshot = reviewSnapshot(c);
    const b = generatePackage(c), r = b.fieldValues.applicant.find(r => r.officialLabel === 'Synthetic sales')!;
    assert.equal(b.report.state, 'needsInformation'); assert.ok(b.report.issues.some(i => i.id === 'unit:sales'));
    assert.equal(r.copyable, false); assert.equal(r.value, null); assert.equal(r.candidate, null);
  }
});
test('P1 a numeric-looking string cannot bypass numeric conversion', () => {
  const c = complete(); field(c, 'sales').value = '1000'; c.fieldMap.fields.find(m => m.fieldId === 'sales')!.unit = '千円'; c.review!.inputSnapshot = reviewSnapshot(c);
  const b = generatePackage(c); assert.equal(b.report.state, 'needsInformation');
  assert.equal(b.fieldValues.applicant.find(r => r.officialLabel === 'Synthetic sales')!.copyable, false);
});
test('P1 fractional thousand yen require an explicitly reviewed rounding policy', () => {
  const c = complete(), m = c.fieldMap.fields.find(m => m.fieldId === 'capitalStockYen')!;
  field(c, 'capitalStockYen').value = 1500; m.unit = 'thousandJPY'; c.review!.inputSnapshot = reviewSnapshot(c);
  assert.ok(validateCase(c).issues.some(i => i.id === 'unit:capitalStockYen'));
  for (const [rounding, value] of [['floor', 1], ['ceil', 2], ['halfAwayFromZero', 2]] as const) {
    m.rounding = rounding; c.review!.inputSnapshot = reviewSnapshot(c);
    const b = generatePackage(c), r = b.fieldValues.applicant.find(r => r.officialLabel === 'Synthetic capitalStockYen')!;
    assert.equal(b.report.state, 'readyForTranscription'); assert.equal(r.value, value); assert.equal(r.conversion!.rawValue, 1.5); assert.equal(r.conversion!.rounding, rounding);
  }
  m.rounding = 'floor'; assert.ok(validateCase(c).issues.some(i => i.id === 'review'));
});
test('P1 inverse conversion, negative rounding and unsafe amounts are deterministic', () => {
  const c = complete(), f = field(c, 'sales'), m = c.fieldMap.fields.find(m => m.fieldId === 'sales')!;
  const inverse = transcriptionValue({ ...f, value: 2, unit: 'thousandJPY' }, { ...m, unit: '円' });
  assert.ok(inverse.ok); if (inverse.ok) assert.equal(inverse.value, 2000);
  for (const [rounding, value] of [['floor', -2], ['ceil', -1], ['halfAwayFromZero', -2]] as const) {
    const result = transcriptionValue({ ...f, value: -1500 }, { ...m, unit: '千円', rounding });
    assert.ok(result.ok); if (result.ok) assert.equal(result.value, value);
  }
  assert.equal(transcriptionValue({ ...f, value: Number.MAX_SAFE_INTEGER, unit: 'thousandJPY' }, m).ok, false);
  assert.equal(transcriptionValue({ ...f, unit: '__proto__' }, { ...m, unit: '__proto__' }).ok, false);
  assert.equal(transcriptionValue({ ...f, unit: 'USD' }, { ...m, unit: 'USD' }).ok, false);
});
test('P1 length limits apply to the converted copy value', () => {
  const c = complete(), m = c.fieldMap.fields.find(m => m.fieldId === 'capitalStockYen')!;
  m.unit = '千円'; m.maxLength = 2; c.review!.inputSnapshot = reviewSnapshot(c);
  assert.equal(validateCase(c).state, 'readyForTranscription');
});
function priorDecemberCase() {
  const c = complete(); field(c, 'periodStart').value = '2025-01-01'; field(c, 'periodEnd').value = '2025-12-31';
  for (const f of c.fields.filter(f => !f.fieldId.startsWith('plan.'))) f.periodEnd = '2025-12-31';
  c.requiredPeriods = { latest: '2025-12-31', productivity: '2025-12-31', wages: '2025-12-31', ruleVersion: c.rulePack.version };
  c.attachments[0].periodEnd = '2025-12-31'; c.attachments[0].expectedPeriodEnd = '2025-12-31';
  c.review!.inputSnapshot = reviewSnapshot(c); return c;
}
test('P2 reviewed prior December financials matching required years can be ready with a notice', () => {
  const c = priorDecemberCase(), b = generatePackage(c);
  assert.equal(b.report.state, 'readyForTranscription'); assert.deepEqual(b.report.issues, []);
  assert.ok(b.report.notices.some(i => i.id === 'historical-period'));
  assert.ok(b.applicantHtml.includes('申請年より前の決算')); assert.ok(!b.vendorHtml.includes('申請年より前の決算'));
});
test('P2 mismatched and unconfirmed required years still block readiness', () => {
  for (const expected of ['2024-12-31', null]) {
    const c = priorDecemberCase(); c.requiredPeriods.latest = expected; c.review!.inputSnapshot = reviewSnapshot(c);
    const r = validateCase(c); assert.equal(r.state, 'needsInformation');
    assert.ok(r.issues.some(i => i.id === (expected ? 'period:latest:assets' : 'period-rule:latest')));
  }
});
test('A01 cross-case evidence, duplicate IDs and source hashes are rejected', () => {
  const c = complete(); field(c, 'sales').caseId = 'OTHER'; assert.throws(() => caseSchema.parse(c));
  const d = complete(); d.fields.push(d.fields[0]); assert.throws(() => caseSchema.parse(d));
  const e = complete(); field(e, 'sales').fileSha256 = 'b'.repeat(64); assert.throws(() => caseSchema.parse(e));
});
test('A02 extracted OCR, absent review and invalid physical pages cannot qualify', () => {
  const c = complete(); field(c, 'sales').state = 'extracted'; assert.notEqual(validateCase(c).state, 'readyForTranscription');
  field(c, 'sales').page = 11; assert.throws(() => caseSchema.parse(c));
  const d = complete(); field(d, 'sales').originalChecked = false; assert.notEqual(validateCase(d).state, 'readyForTranscription');
});
test('A03 short first-year, outdated financials and unknown required year block', () => {
  const c = complete(); field(c, 'periodStart').value = '2024-03-13'; field(c, 'periodEnd').value = '2024-05-31'; field(c, 'sales').periodEnd = '2024-05-31';
  const r = validateCase(c); assert.ok(r.issues.some(i => i.id === 'short-period')); assert.ok(r.issues.some(i => i.id === 'period:latest:sales')); assert.equal(field(c, 'sales').value, 1000);
  c.requiredPeriods.latest = null; assert.ok(validateCase(c).issues.some(i => i.id === 'period-rule:latest'));
});
test('A04 BS/PL mismatch and ordinary profit label are blocked with evidence IDs', () => {
  const c = complete(); field(c, 'assets').value = 101; field(c, 'operatingProfit').originalLabel = '経常利益';
  const r = validateCase(c); assert.ok(r.issues.some(i => i.id === 'equation:assets' && i.fieldId === 'assets')); assert.ok(r.issues.some(i => i.id === 'label:operatingProfit'));
});
test('A05 null, ambiguous identity, gaiji and API error are separate blockers', () => {
  for (const status of ['ambiguous', 'failed', 'notFound', 'unverified'] as const) { const c = complete(); c.apiChecks[0].status = status; assert.notEqual(validateCase(c).state, 'readyForTranscription'); }
  const c = complete(); c.apiChecks[0].addressImageId = 'TEST'; field(c, 'capitalStockYen').value = null;
  assert.ok(validateCase(c).issues.some(i => i.id === 'api:nta')); assert.notEqual(validateCase(c).state, 'readyForTranscription');
});
test('A05 live adapter preserves errors without exposing upstream text', async () => {
  const r = await enrichCompany(complete(), {}, { nta: async () => { throw new NtaApiError('SECRET', 'timeout'); }, gbiz: async () => { throw new GBizInfoApiError('TOKEN', 'authentication_error'); } });
  assert.deepEqual(r.apiChecks.slice(-2).map(a => a.code), ['timeout', 'authentication_error']); assert.ok(!JSON.stringify(r).includes('SECRET')); assert.ok(!JSON.stringify(r).includes('TOKEN'));
});
test('A06 productivity and wage periods differ for June closing', () => {
  const c = complete(); assert.equal(validateCase(c).state, 'readyForTranscription');
  field(c, 'wageTotal').periodEnd = '2026-06-30'; assert.ok(validateCase(c).issues.some(i => i.id === 'period:wages:wageTotal'));
});
test('A06 latest financials and productivity baseline can use different June years', () => {
  const c = complete();
  c.fields.push(...['assets', 'sales'].map(id => ({ ...field(c, id), fieldId: `latest.${id}` })));
  for (const id of ['assets', 'liabilities', 'netAssets', 'sales', 'costOfSales', 'grossProfit', 'sellingGeneralAdministrative', 'operatingProfit', 'personnelCosts', 'depreciation', 'annualTotalHours']) field(c, id).periodEnd = '2025-06-30';
  c.requiredPeriods.productivity = '2025-06-30'; c.review!.inputSnapshot = reviewSnapshot(c);
  assert.equal(validateCase(c).state, 'readyForTranscription');
});
test('A07 deterministic synthetic plan and time calculations', () => {
  assert.deepEqual(timeSaving(200, 3, 2), { beforeMinutes: 600, afterMinutes: 400, savedMinutes: 200 });
  assert.equal(productivity(1_000_000, 25_000_000, 1_000_000, 10_000), 2700);
  assert.deepEqual([5_000_000, 5_300_000, 5_600_000, 5_900_000].map((profit, i) => productivity(profit, [20_000_000, 20_600_000, 21_218_000, 21_854_540][i], 2_000_000, 10_000)),
    [2700, 2790, 2881.8, 2975.454]);
  assert.equal(compound(18_000_000, .03, 3)[3].display, 19_669_086);
  assert.equal(productivity(1, 2, 3, 0), null); assert.equal(productivity(1, 2, null, 1), null);
  assert.equal(growth(0, 1), null); assert.equal(growth(-1, 1), null); assert.equal(growth(1, Infinity), null);
});
test('A07 normalization preserves units, negative marks and blank values', () => {
  assert.equal(normalizeAmount('△１,２３４', 'thousandJPY'), -1234000); assert.equal(normalizeAmount('(25)', 'JPY'), -25);
  assert.equal(normalizeAmount('', 'JPY'), null); assert.equal(normalizeAmount('0', 'JPY'), 0); assert.throws(() => normalizeAmount('abc', 'JPY'));
});
test('A08 two-year totals, tax and ineligible costs are not multiplied twice', () => {
  const c = complete(); const r = quote([{ netYen: 400_000, taxYen: 40_000, quantity: 1, months: 24, basis: 'periodTotal', eligible: true, registrationVerified: true },
    { netYen: 10_000, taxYen: 1000, quantity: 1, months: 1, basis: 'periodTotal', eligible: false, registrationVerified: true }], c.rulePack);
  assert.equal(r.eligibleYen, 400000); assert.equal(r.displayGrantYen, 200000); assert.equal(r.taxYen, 41000);
  assert.ok(quote([{ netYen: 400000, taxYen: 0, quantity: 1, months: 24, basis: 'periodTotal', eligible: null, registrationVerified: false }], c.rulePack).blockers.length);
});
test('A09 product family, missing registration and wrong year never qualify', () => {
  for (const change of [{ verified: false }, { year: 2025 }, { toolNumber: null }, { registrationReference: null }]) {
    const c = complete(); Object.assign(c.product, change); assert.ok(validateCase(c).issues.some(i => i.id === 'product'));
  }
});
test('A10 document instructions are inert, escaped and cannot ground facts', () => {
  const c = complete(); field(c, 'businessSummary').value = '</pre><script>fetch("https://evil.test")</script>';
  const html = generatePackage(c).applicantHtml; assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>fetch'));
  field(c, 'businessSummary').state = 'assumed'; assert.throws(() => groundedSentences(c, [{ template: '{businessSummary}', fieldIds: ['businessSummary'], kind: 'fact' }]));
});
test('A11 missing, expired, changed form and incorrect year attachments block', () => {
  for (const mutation of [(c: AssistCase) => { c.attachments = []; }, (c: AssistCase) => { c.attachments[0].expiresAt = '2026-11-06'; },
    (c: AssistCase) => { c.attachments[0].mappingVersion = 'old'; }, (c: AssistCase) => { c.attachments[0].periodEnd = '2024-01-01'; }]) {
    const c = complete(); mutation(c); assert.notEqual(validateCase(c).state, 'readyForTranscription');
  }
});
test('A12 vendor HTML and field rows exclude private values, source path and private source', () => {
  const c = complete(); c.fieldMap.fields[0].actor = 'vendor'; field(c, 'corporateNumber').value = 'PRIVATE-SECRET'; field(c, 'corporateNumber').visibility = 'applicantOnly';
  const b = generatePackage(c); assert.ok(!b.vendorHtml.includes('PRIVATE-SECRET')); assert.ok(!b.vendorHtml.includes('/synthetic/')); assert.equal(b.fieldValues.vendor.length, 0);
  field(c, 'corporateNumber').visibility = 'vendorShareable'; c.sources[0].visibility = 'applicantOnly'; assert.equal(generatePackage(c).fieldValues.vendor.length, 0);
});
test('A13 editing values or rules invalidates reviews and creates a distinguishable revision', () => {
  const c = complete(), changed = reviseCase(c, { rulePack: { ...c.rulePack, version: 'new-rule' } });
  assert.equal(changed.revision, 2); assert.equal(changed.review, null); assert.ok(changed.fields.every(f => !f.originalChecked && !f.reviewedAt));
  assert.notEqual(validateCase(changed).state, 'readyForTranscription'); assert.equal(c.revision, 1); assert.ok(generatePackage(changed).applicantHtml.includes('revision 2'));
});
test('A13 direct JSON edits cannot retain a prior ready review', () => {
  const c = complete(); field(c, 'sales').value = 1001; field(c, 'grossProfit').value = 801; field(c, 'operatingProfit').value = 501;
  assert.ok(validateCase(c).issues.some(i => i.id === 'review')); assert.ok(generatePackage(c).fieldValues.applicant.every(r => !r.copyable));
});
test('A14 complete independent synthetic case qualifies only as a test', () => {
  const c = complete(), r = validateCase(c); assert.deepEqual(r.issues, []); assert.equal(r.state, 'readyForTranscription'); assert.equal(r.testOnly, true);
  assert.ok(generatePackage(c).applicantHtml.includes('実申請には使用不可'));
  c.dataClass = 'private_actual'; assert.notEqual(validateCase(c).state, 'readyForTranscription');
});
test('numeric productivity plans are required even when narrative and review are complete', () => {
  const c = complete(); c.fields = c.fields.filter(f => !f.fieldId.startsWith('plan.'));
  c.review!.inputSnapshot = reviewSnapshot(c);
  assert.equal(validateCase(c).state, 'needsInformation');
  assert.equal(generatePackage(c).fieldValues.applicant.find(r => r.officialLabel === 'Synthetic productivityPlan')!.copyable, false);
});
test('wage increases offset by reduced profits cannot pass numeric productivity validation', () => {
  const c = complete();
  for (let year = 1; year <= 3; year++) {
    field(c, `plan.${year}.personnelCosts`).value = 200 + year * 10;
    field(c, `plan.${year}.operatingProfit`).value = 500 - year * 10;
  }
  c.review!.inputSnapshot = reviewSnapshot(c);
  const r = validateCase(c);
  assert.equal(r.state, 'needsInformation');
  assert.deepEqual(r.productivity.projection.map(p => p.growthPercent), [0, 0, 0]);
  assert.ok(r.issues.some(i => i.id === 'productivity-target:1'));
  assert.ok(r.issues.some(i => i.id === 'productivity-target:3'));
});
test('three-year target, zero hours, wrong units, wrong periods and unconfirmed forecasts block readiness', () => {
  for (const mutate of [
    (c: AssistCase) => { field(c, 'plan.3.operatingProfit').value = 500; },
    (c: AssistCase) => { field(c, 'plan.2.annualTotalHours').value = 0; },
    (c: AssistCase) => { field(c, 'plan.1.personnelCosts').unit = 'thousandJPY'; },
    (c: AssistCase) => { field(c, 'plan.1.personnelCosts').periodEnd = '2026-06-30'; },
    (c: AssistCase) => { field(c, 'plan.1.personnelCosts').applicantConfirmed = false; },
    (c: AssistCase) => { c.projectionPeriods = ['2028-06-30', '2028-06-30', '2030-06-30']; },
  ]) { const c = complete(); mutate(c); c.review!.inputSnapshot = reviewSnapshot(c); assert.equal(validateCase(c).state, 'needsInformation'); }
});
test('simulation completion and unperformed security declaration remain separate', () => {
  const c = complete(); assert.equal(validateCase(c).completionKind, 'simulationReady');
  field(c, 'securityActionReady').value = false; c.review!.inputSnapshot = reviewSnapshot(c);
  const r = validateCase(c); assert.equal(r.completionKind, 'incomplete');
  assert.deepEqual(r.issues.map(i => i.id), ['confirmation:securityActionReady']);
});

test('exact productivity thresholds pass without display-rounding below-threshold values upward', () => {
  const c = complete();
  for (let year = 1; year <= 3; year++) field(c, `plan.${year}.operatingProfit`).value = 750 * 1.03 ** year - 250;
  c.review!.inputSnapshot = reviewSnapshot(c);
  assert.equal(validateCase(c).state, 'readyForTranscription');
  field(c, 'plan.3.operatingProfit').value = Number(field(c, 'plan.3.operatingProfit').value) - 0.01;
  c.review!.inputSnapshot = reviewSnapshot(c);
  assert.deepEqual(validateCase(c).issues.map(i => i.id), ['productivity-target:3']);
});
test('unsupported frame is preserved, declarations cannot be copied, unknown cannot be zero', () => {
  const c = complete(); c.scope.frame = 'invoice'; assert.equal(validateCase(c).state, 'unsupported'); assert.equal(c.scope.frame, 'invoice');
  const d = complete(); d.fieldMap.fields[0].inputType = 'declaration'; assert.equal(generatePackage(d).fieldValues.applicant[0].copyable, false);
  field(d, 'sales').value = null; field(d, 'sales').state = 'unknown'; assert.equal(generatePackage(d).fieldValues.applicant.find(r => r.officialLabel === 'Synthetic sales')!.value, null);
});
