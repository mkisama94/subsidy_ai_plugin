import { caseSchema, type AssistCase } from './schema';

export function createDraft(caseId: string, companyId: string, dataClass: AssistCase['dataClass'], applicationDate: string): AssistCase {
  return caseSchema.parse({ schemaVersion: '1', caseId, companyId, dataClass, revision: 1, applicationDate,
    scope: { year: 2026, round: 7, frame: 'normal', requestedGrantYen: null, standardRate: true, priorGrant: null },
    sources: [], fields: [], requiredPeriods: { latest: null, productivity: null, wages: null, ruleVersion: null },
    rulePack: { version: '2026-normal-round7-pending-v1', year: 2026, roundFrom: 7, effectiveFrom: '2026-10-09', verified: false,
      testOnly: false, reviewer: null, rateNumerator: 1, rateDenominator: 2, grantMinYen: 50_000, grantMaxExclusiveYen: 1_500_000, maxMonths: 24,
      references: ['https://it-shien.smrj.go.jp/pdf/it2026_kaitei_koubo_tsujyo.pdf', 'https://it-shien.smrj.go.jp/pdf/it2026_manual_kofu.pdf']
        .map(url => ({ url, sha256: null, retrievedAt: null, revisedAt: null, page: null })) },
    fieldMap: { version: '2026-pending-v1', complete: false, testOnly: false, fields: [] },
    product: { version: 'pca-pending-v1', name: 'PCA会計（候補）', plan: null, toolNumber: null, vendorNumber: null,
      year: 2026, frame: 'normal', verified: false, testOnly: false, registrationReference: null, featureReferences: [] },
    requiredAttachmentIds: [], attachments: [], apiChecks: [], review: null });
}
