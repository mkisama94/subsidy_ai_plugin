import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createDraft } from '../../src/applicationAssist/draft';
import { caseSchema, type FieldEvidence } from '../../src/applicationAssist/schema';
import { readJson, registerFile, writePackage } from './storage';

const manifestSchema = z.object({ createdAt: z.iso.date(), files: z.array(z.object({ caseId: z.string(), path: z.string(), sha256: z.string(), dataClass: z.enum(['private_actual', 'fictional_example']) })),
  privateCase: z.object({ corporateNumber: z.object({ value: z.string(), page: z.number() }), period: z.object({ start: z.string(), end: z.string(), page: z.number() }),
    readback: z.object({ unit: z.literal('JPY'), balanceSheetPage: z.number(), profitLossPage: z.number() }).catchall(z.union([z.string(), z.number()])),
    reviewScope: z.string(), publicLookup: z.object({ performedDateJst: z.string(), sourceUpdateDate: z.string(), name: z.string(), location: z.string(), capitalStockYen: z.number().nullable(), employeeNumber: z.number().nullable(), addressImageId: z.string().nullable(), notice: z.string() }),
  }) });
const labels: Record<string, string> = { assets: '資産合計', liabilities: '負債合計', netAssets: '純資産合計', capitalAtPeriodEnd: '資本金（期末）', sales: '売上高', costOfSales: '売上原価', grossProfit: '売上総利益', sellingGeneralAdministrative: '販売費及び一般管理費', operatingProfit: '営業利益', ordinaryProfit: '経常利益', netProfit: '当期純利益' };
export async function importManifest(path: string, applicationDate: string) {
  const m = manifestSchema.parse(await readJson(path));
  const results = [];
  for (const file of m.files) {
    const c = createDraft(file.caseId, `${file.caseId}-company`, file.dataClass, applicationDate);
    const sourceId = `${file.caseId}-original`;
    const original = await registerFile(file.path, file.sha256, file.dataClass === 'private_actual' ? 'pdf' : 'docx');
    c.sources.push({ sourceId, caseId: c.caseId, companyId: c.companyId, path: original.path, sha256: original.sha256,
      pageCount: original.pageCount, kind: original.kind, url: null, visibility: 'applicantOnly' });
    const evidence = (fieldId: string, value: FieldEvidence['value'], page: number | null, unit: string | null, originalLabel: string): FieldEvidence => ({
      fieldId, caseId: c.caseId, companyId: c.companyId, value, page, unit, originalLabel, originalText: String(value ?? ''),
      periodStart: file.dataClass === 'private_actual' ? m.privateCase.period.start : null, periodEnd: file.dataClass === 'private_actual' ? m.privateCase.period.end : null, asOfDate: null,
      state: 'extracted', sourceId, fileSha256: original.sha256, url: null, bounds: null, retrievedAt: null, sourceUpdatedAt: null,
      method: 'document', calculation: null, reviewer: null, reviewedAt: null, evidenceVersion: 'manifest-readback-v1',
      originalChecked: false, applicantConfirmed: false, visibility: 'applicantOnly' });
    if (file.dataClass === 'private_actual') {
      const p = m.privateCase;
      c.fields.push(evidence('corporateNumber', p.corporateNumber.value, p.corporateNumber.page, null, '法人番号'), evidence('periodStart', p.period.start, p.period.page, null, '自'), evidence('periodEnd', p.period.end, p.period.page, null, '至'));
      for (const [id, label] of Object.entries(labels)) {
        const value = p.readback[id];
        if (typeof value !== 'number') continue;
        c.fields.push(evidence(id, value, ['assets', 'liabilities', 'netAssets', 'capitalAtPeriodEnd'].includes(id) ? p.readback.balanceSheetPage : p.readback.profitLossPage, 'JPY', label));
      }
      // Previous readback is a candidate, not a new visual review or a fresh API call.
      const apiId = `${c.caseId}-historical-public`;
      c.sources.push({ sourceId: apiId, caseId: c.caseId, companyId: c.companyId, path: null, sha256: null,
        url: 'https://content.info.gbiz.go.jp/api/index.html', pageCount: null, kind: 'publicApi', visibility: 'applicantOnly' });
      for (const [key, value] of Object.entries({ companyName: p.publicLookup.name, location: p.publicLookup.location, capitalStockYen: p.publicLookup.capitalStockYen, employeeNumber: p.publicLookup.employeeNumber })) {
        c.fields.push({ ...evidence(`public.historical.${key}`, value, null, key === 'capitalStockYen' ? 'JPY' : key === 'employeeNumber' ? 'persons' : null, key),
          sourceId: apiId, fileSha256: null, method: 'publicApi', url: 'https://content.info.gbiz.go.jp/api/index.html', periodStart: null, periodEnd: null,
          sourceUpdatedAt: p.publicLookup.sourceUpdateDate, state: value === null ? 'unknown' : 'extracted' });
      }
      c.apiChecks.push({ provider: 'nta', checkedAt: null, checkedOn: p.publicLookup.performedDateJst, status: 'unverified', code: 'historical_manifest_date_only',
        addressImageId: p.publicLookup.addressImageId, addressImageVerified: false, notice: p.publicLookup.notice, sourceUrl: 'https://www.houjin-bangou.nta.go.jp/webapi/' });
    } else {
      // Unzip only the document XML; never run macros, links or embedded instructions.
      const { unzipSync, strFromU8 } = await import('fflate');
      const zip = unzipSync(new Uint8Array(await readFile(file.path)), { filter: f => f.name === 'word/document.xml' });
      const xml = zip['word/document.xml'];
      if (!xml) throw new Error('DOCX document missing');
      c.fields.push({ ...evidence('referenceDocumentText', strFromU8(xml).replace(/<[^>]+>/g, ' ').slice(0, 100_000), null, null, '架空の比較記入例'), state: 'assumed' });
    }
    results.push(await writePackage(caseSchema.parse(c)));
  }
  return results;
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/import-manifest.ts')) {
  try {
    const [path, date] = process.argv.slice(2);
    if (!path || !date) throw new Error('Manifest path and application date required');
    const results = await importManifest(path, date);
    process.stdout.write(JSON.stringify(results) + '\n');
  } catch { process.stderr.write('内部台帳取込みを停止しました。形式・原本ハッシュ・非公開保存先を確認してください。\n'); process.exitCode = 1; }
}
