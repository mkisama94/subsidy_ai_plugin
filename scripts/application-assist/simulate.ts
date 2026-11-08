import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { getDocumentProxy, extractText } from 'unpdf';
import { caseSchema } from '../../src/applicationAssist/schema';
import { reviewSnapshot } from '../../src/applicationAssist/engine';
import { hash, readJson, writePackage } from './storage';

// Explicit simulation input, not a production evidence-review shortcut.
const inputSchema = z.object({ schema: z.literal('application-assist-simulation-v1'),
  testOnly: z.literal(true), case: caseSchema, notes: z.string().min(1) }).strict();
const normalized = (text: string) => text.normalize('NFKC').replace(/\s+/g, '');

export async function runSimulation(path: string) {
  const input = inputSchema.parse(await readJson(path)), c = input.case;
  if (c.dataClass !== 'synthetic_test' || !c.rulePack.testOnly || !c.product.testOnly || !c.fieldMap.testOnly)
    throw new Error('Simulation inputs only');
  const pages = new Map<string, string[]>();
  for (const source of c.sources) {
    if (!source.path || !source.sha256) throw new Error('Simulation source file required');
    source.path = resolve(dirname(path), source.path);
    const bytes = await readFile(source.path);
    if (hash(bytes) !== source.sha256) throw new Error('Simulation source changed');
    if (source.kind === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
      try {
        if (pdf.numPages !== source.pageCount) throw new Error('Simulation page count mismatch');
        const result = await extractText(pdf, { mergePages: false });
        pages.set(source.sourceId, result.text);
      } finally { await pdf.loadingTask.destroy(); }
    }
  }
  for (const field of c.fields.filter(f => f.method === 'document')) {
    const page = pages.get(field.sourceId)?.[(field.page ?? 0) - 1];
    if (!page || !normalized(field.originalText) || !normalized(page).includes(normalized(field.originalText)))
      throw new Error(`Simulation source excerpt mismatch: ${field.fieldId}`);
  }
  // The declared field reviews are fixture state. This only records reproducible
  // simulation validation, never human review or a live public-API call.
  if (c.review) c.review = { reviewer: 'simulation-runner (test only)', reviewedAt: new Date().toISOString(),
    revision: c.revision, inputSnapshot: reviewSnapshot({ ...c, review: null }) };
  return writePackage(c);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error('Simulation input required');
    const result = await runSimulation(resolve(path));
    console.log(JSON.stringify({ ...result, testOnly: true }));
  } catch {
    console.error('模擬入力・原本ハッシュ・ページ・引用・非公開保存先を確認してください。実案件はこの入口で扱えません。');
    process.exitCode = 1;
  }
}
