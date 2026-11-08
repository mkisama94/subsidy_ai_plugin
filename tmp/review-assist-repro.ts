import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft } from '../src/applicationAssist/draft';
import { caseSchema, type AssistCase, type FieldEvidence } from '../src/applicationAssist/schema';
import { requiredFacts, reviseCase, validateCase, reviewSnapshot } from '../src/applicationAssist/engine';
import { generatePackage } from '../src/applicationAssist/output';
import { normalizeAmount, timeSaving, productivity, growth, compound, quote } from '../src/applicationAssist/calculations';
import { groundedSentences } from '../src/applicationAssist/narrative';
import { enrichCompany } from '../src/applicationAssist/company';
import { NtaApiError } from '../src/nta';
import { GBizInfoApiError } from '../src/gbizinfo';

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
    unit: null, maxLength: null, choices: [], reference: ref, manualChecked: true, screenCheckedAt: '2026-11-07' })) };
  c.requiredAttachmentIds = ['TEST-ATTACHMENT'];
  c.attachments = [{ attachmentId: 'TEST-ATTACHMENT', sourceId: 'synthetic-source', screenId: 'TEST-SCREEN', officialLabel: 'Synthetic attachment', required: true,
    periodEnd: '2026-06-30', expectedPeriodEnd: '2026-06-30', expiresAt: '2026-12-01', format: 'pdf', bytes: 100, maxBytes: 1000,
    verified: true, mappingVersion: 'test-map', visibility: 'applicantOnly' }];
  c.apiChecks = [{ provider: 'nta', checkedAt: now, checkedOn: null, status: 'matched', code: null, addressImageId: null, addressImageVerified: false, notice: 'test', sourceUrl: ref.url }];
  c.review = { reviewer: 'test', reviewedAt: now, revision: 1, inputSnapshot: reviewSnapshot(c) };
  return c;
}
const field = (c: AssistCase, id: string) => c.fields.find(f => f.fieldId === id)!;
const h=complete(); field(h,'periodStart').value='2025-01-01';field(h,'periodEnd').value='2025-12-31';for(const f of h.fields)if(f.periodEnd==='2026-06-30')f.periodEnd='2025-12-31';h.requiredPeriods.latest='2025-12-31';h.requiredPeriods.productivity='2025-12-31';h.review!.inputSnapshot=reviewSnapshot(h);console.log('HISTORICAL',JSON.stringify(validateCase(h).issues));
const u=complete();u.fieldMap.fields.find(m=>m.fieldId==='sales')!.unit='thousandJPY';u.review!.inputSnapshot=reviewSnapshot(u);console.log('UNIT',validateCase(u).state,JSON.stringify(generatePackage(u).fieldValues.applicant.find(r=>r.officialLabel==='Synthetic sales')));
