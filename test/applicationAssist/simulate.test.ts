import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { createDraft } from '../../src/applicationAssist/draft';
import { hash } from '../../scripts/application-assist/storage';
import { runSimulation } from '../../scripts/application-assist/simulate';

// Small valid one-page PDF: no company data, external tools or generated fixture answers.
function pdf(text: string) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let result = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(result.length); result += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = result.length;
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return result + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

test('simulation validates real bytes/pages/excerpts and never upgrades an incomplete or real case', async () => {
  const previous = process.env.SUBSIDY_ASSIST_PRIVATE_DIR;
  const root = await mkdtemp(join(tmpdir(), 'subsidy-simulation-'));
  try {
    process.env.SUBSIDY_ASSIST_PRIVATE_DIR = join(root, 'outputs');
    const bytes = pdf('Synthetic business'); await writeFile(join(root, 'source.pdf'), bytes);
    const c = createDraft('SIM-TEST', 'SIM-COMPANY', 'synthetic_test', '2026-11-08');
    c.rulePack.testOnly = c.product.testOnly = c.fieldMap.testOnly = true;
    c.sources = [{ sourceId: 'source', caseId: c.caseId, companyId: c.companyId, path: 'source.pdf', sha256: hash(bytes),
      kind: 'pdf', url: null, pageCount: 1, visibility: 'applicantOnly' }];
    c.fields = [{ fieldId: 'businessSummary', caseId: c.caseId, companyId: c.companyId, value: 'Synthetic business',
      unit: null, periodStart: null, periodEnd: null, asOfDate: null, state: 'verified', sourceId: 'source', fileSha256: hash(bytes),
      url: null, page: 1, bounds: null, originalLabel: 'business', originalText: 'Synthetic business', retrievedAt: null,
      sourceUpdatedAt: null, method: 'document', calculation: null, reviewer: 'synthetic-fixture', reviewedAt: '2026-11-08T00:00:00Z',
      evidenceVersion: 'test', originalChecked: true, applicantConfirmed: true, visibility: 'applicantOnly' }];
    const input = { schema: 'application-assist-simulation-v1', testOnly: true, notes: 'Synthetic fixture only', case: c };
    const inputPath = join(root, 'simulation-input.json');
    const save = () => writeFile(inputPath, JSON.stringify(input));
    await save();
    const result = await runSimulation(inputPath);
    assert.equal(result.state, 'needsInformation');
    const report = JSON.parse(await readFile(join(result.folder, 'validation-report.json'), 'utf8'));
    assert.equal(report.completionKind, 'incomplete'); assert.equal(report.testOnly, true);
    assert.ok(report.issues.some((i: { id: string }) => i.id === 'review'));
    assert.ok((await readFile(join(result.folder, 'assessment-summary.html'), 'utf8')).includes('未完成・要確認'));

    c.dataClass = 'private_actual'; await save(); await assert.rejects(() => runSimulation(inputPath), /Simulation inputs only/);
    c.dataClass = 'synthetic_test'; c.product.testOnly = false;
    await save(); await assert.rejects(() => runSimulation(inputPath), /Simulation inputs only/);
    c.product.testOnly = true;
    c.fields[0].originalText = 'Absent evidence'; await save();
    await assert.rejects(() => runSimulation(inputPath), /excerpt mismatch/);
    c.fields[0].originalText = 'Synthetic business'; c.sources[0].pageCount = 2; await save();
    await assert.rejects(() => runSimulation(inputPath), /page count mismatch/);
    c.sources[0].pageCount = 1; await save(); await writeFile(join(root, 'source.pdf'), bytes + '\nchanged');
    await assert.rejects(() => runSimulation(inputPath), /source changed/);
  } finally {
    if (previous === undefined) delete process.env.SUBSIDY_ASSIST_PRIVATE_DIR; else process.env.SUBSIDY_ASSIST_PRIVATE_DIR = previous;
    const target = relative(tmpdir(), root); assert.ok(target && !isAbsolute(target) && !target.startsWith('..'));
    await rm(root, { recursive: true, force: true });
  }
});
