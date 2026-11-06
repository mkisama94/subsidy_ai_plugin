import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseSchema } from '../../src/applicationAssist/schema';
import { privateRoot, readJson, writeJson, registerFile, hash } from './storage';

// Explicit local renderer/library/model locations. No fallback to remote OCR or model downloads.
export async function ocrCase(path: string, sourceId: string, first: number, last: number) {
  const c = caseSchema.parse(await readJson(path)), s = c.sources.find(s => s.sourceId === sourceId);
  if (!s || s.kind !== 'pdf' || !s.path || !s.sha256) throw new Error('PDF source required');
  const original = await registerFile(s.path, s.sha256, 'pdf');
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > original.pageCount!) throw new Error('Invalid page range');
  const python = process.env.SUBSIDY_ASSIST_PYTHON;
  const moduleRoot = process.env.SUBSIDY_ASSIST_NODE_MODULES;
  const languages = process.env.SUBSIDY_ASSIST_OCR_LANG_DIR;
  if (!python || !moduleRoot || !languages) throw new Error('Local OCR runtime and language directory required');
  for (const lang of ['jpn', 'eng']) await access(join(languages, `${lang}.traineddata.gz`));
  const folder = join(await privateRoot(), `ocr-${hash(c.caseId).slice(0, 12)}-${s.sha256.slice(0, 12)}-${Date.now()}`);
  await mkdir(folder);
  await promisify(execFile)(python, [fileURLToPath(new URL('render_pdf.py', import.meta.url)), s.path, folder, String(first), String(last)], { timeout: 180_000, windowsHide: true });
  const require = createRequire(join(moduleRoot, 'application-assist-loader.cjs'));
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('jpn+eng', 1, { langPath: languages, cacheMethod: 'none', gzip: true });
  try {
    for (let page = first; page <= last; page++) {
      const imagePath = join(folder, `page-${String(page).padStart(4, '0')}.png`);
      const { data } = await worker.recognize(imagePath, {}, { text: true, blocks: true });
      await writeJson(join(folder, `page-${page}.json`), { caseId: c.caseId, companyId: c.companyId, sourceId,
        fileSha256: s.sha256, page, imagePath, method: 'local-tesseract', state: 'extracted',
        reviewer: null, reviewedAt: null, text: data.text, confidence: data.confidence, blocks: data.blocks });
    }
  } finally { await worker.terminate(); }
  return { folder, pageCount: last - first + 1, state: 'extracted' };
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/ocr.ts')) {
  try {
    const [path, sourceId, first, last] = process.argv.slice(2);
    process.stdout.write(JSON.stringify(await ocrCase(path, sourceId, Number(first), Number(last))) + '\n');
  } catch { process.stderr.write('ローカルOCRを停止しました。原本・ページ・ローカル実行環境・日本語モデルを確認してください。\n'); process.exitCode = 1; }
}
