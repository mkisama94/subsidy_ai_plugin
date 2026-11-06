import { getCorporateIdentity, NTA_NOTICE, NtaApiError } from '../nta';
import { getCompanyProfile, GBizInfoApiError } from '../gbizinfo';
import { reviseCase, usable } from './engine';
import type { AssistCase, FieldEvidence } from './schema';

/** Only a reviewed corporate number is sent. No private document upload. */
export async function enrichCompany(c: AssistCase, credentials: { ntaId?: string; gbizToken?: string },
  clients = { nta: getCorporateIdentity, gbiz: getCompanyProfile }, checkedAt = new Date().toISOString()): Promise<AssistCase> {
  const number = c.fields.find(f => f.fieldId === 'corporateNumber');
  if (!number || !usable(number) || !number.originalChecked || !/^\d{13}$/.test(String(number.value))) throw new Error('Reviewed document corporate number required');
  const next = reviseCase(c, {});
  // A public lookup does not edit original document values. Keep their actual
  // visual-review evidence, while invalidating the case review and calculations.
  next.fields = next.fields.map((f, i) => c.fields[i].method === 'document' ? { ...c.fields[i] } : f);
  // A public lookup does not edit original document values. Keep their actual
  // visual-review evidence, while invalidating the case review and calculations.
  next.fields = next.fields.map((f, i) => c.fields[i].method === 'document' ? { ...c.fields[i] } : f);
  for (const provider of ['nta', 'gbizinfo'] as const) {
    const sourceId = `${provider}-${next.revision}`;
    const sourceUrl = provider === 'nta' ? 'https://www.houjin-bangou.nta.go.jp/webapi/' : 'https://content.info.gbiz.go.jp/api/index.html';
    try {
      const response = provider === 'nta' ? await clients.nta(String(number.value), credentials.ntaId) : await clients.gbiz(String(number.value), credentials.gbizToken);
      const rows = 'corporations' in response ? response.corporations : [response.company];
      const matched = rows.filter(r => r.corporateNumber === number.value);
      const row = matched.length === 1 && rows.length === 1 ? matched[0] : null;
      next.apiChecks.push({ provider, checkedAt, checkedOn: null, status: row ? 'matched' : rows.length > 1 ? 'ambiguous' : 'notFound', code: null,
        addressImageId: row && 'addressImageId' in row ? row.addressImageId : null, addressImageVerified: false,
        notice: provider === 'nta' ? NTA_NOTICE : '公開情報の非掲載は不存在・申請資格を保証しません', sourceUrl });
      if (!row) continue;
      next.sources.push({ sourceId, caseId: c.caseId, companyId: c.companyId, path: null, sha256: null, url: sourceUrl, pageCount: null, kind: 'publicApi', visibility: 'applicantOnly' });
      for (const [key, value] of Object.entries({ corporateNumber: row.corporateNumber, companyName: row.name, location: row.location,
        capitalStockYen: 'capitalStockYen' in row ? row.capitalStockYen : null, employeeNumber: 'employeeNumber' in row ? row.employeeNumber : null })) {
        const prior = c.fields.find(f => f.fieldId === key);
        const sameBasis = key === 'corporateNumber' || (prior?.periodEnd === null && prior?.asOfDate !== null && prior?.asOfDate === row.updateDate);
        const conflict = sameBasis && value !== null && prior?.value != null && String(prior.value).normalize('NFKC') !== String(value).normalize('NFKC');
        const field: FieldEvidence = { fieldId: `public.${provider}.${next.revision}.${key}`, caseId: c.caseId, companyId: c.companyId,
          value, unit: key === 'capitalStockYen' ? 'JPY' : key === 'employeeNumber' ? 'persons' : null,
          periodStart: null, periodEnd: null, asOfDate: null, state: conflict ? 'conflict' : value === null ? 'unknown' : 'extracted',
          sourceId, fileSha256: null, url: sourceUrl, page: null, originalLabel: key, originalText: String(value ?? ''), bounds: null,
          retrievedAt: checkedAt, sourceUpdatedAt: row.updateDate, method: 'publicApi', calculation: null,
          reviewer: null, reviewedAt: null, evidenceVersion: `public-${next.revision}`, originalChecked: false, applicantConfirmed: false, visibility: 'applicantOnly' };
        next.fields.push(field);
      }
    } catch (e) {
      const code = e instanceof NtaApiError || e instanceof GBizInfoApiError ? e.code : 'upstream_error';
      next.apiChecks.push({ provider, checkedAt, checkedOn: null, status: 'failed', code, addressImageId: null, addressImageVerified: false, notice: provider === 'nta' ? NTA_NOTICE : '', sourceUrl });
    }
  }
  return next;
}
