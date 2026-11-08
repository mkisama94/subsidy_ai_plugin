import { mkdir, realpath, readFile, writeFile, stat, copyFile, rename } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { caseSchema } from '../../src/applicationAssist/schema';
import { generatePackage } from '../../src/applicationAssist/output';

const repo = fileURLToPath(new URL('../../', import.meta.url));
export const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
function inside(parent: string, child: string) { const r = relative(parent, child); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); }
export async function privateRoot() {
  const configured = process.env.SUBSIDY_ASSIST_PRIVATE_DIR;
  if (!configured || !isAbsolute(configured)) throw new Error('SUBSIDY_ASSIST_PRIVATE_DIR must be an absolute private directory');
  // Resolve existing ancestor BEFORE creating directories (including junctions).
  let ancestor = resolve(configured), suffix: string[] = [];
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const parent = dirname(ancestor); if (parent === ancestor) throw e; suffix.unshift(relative(parent, ancestor)); ancestor = parent; }
  }
  const root = resolve(ancestor, ...suffix), actualRepo = await realpath(repo);
  if (inside(actualRepo, root) || inside(root, actualRepo)) throw new Error('Private output must be outside repository and its ancestors');
  await mkdir(root, { recursive: true });
  return realpath(root);
}
export async function readJson(path: string) { return JSON.parse(await readFile(path, 'utf8')); }
export async function writeJson(path: string, value: unknown) { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); }
export async function writePackage(input: unknown) {
  const c = caseSchema.parse(input), root = await privateRoot();
  for (const s of c.sources.filter(s => s.path && s.sha256)) {
    if (hash(await readFile(s.path!)) !== s.sha256) throw new Error('Source changed; re-intake and review required');
  }
  const bundle = generatePackage(c);
  // Every run is immutable; its content digest identifies the exact inputs.
  const digest = hash(JSON.stringify(c));
  const finalFolder = join(root, `case-${hash(c.caseId).slice(0, 12)}-r${c.revision}-${digest.slice(0, 12)}-${Date.now()}`);
  const folder = join(root, `.pending-${hash(finalFolder).slice(0, 24)}`);
  if (!inside(root, folder) || !inside(root, finalFolder)) throw new Error('Invalid export target');
  await mkdir(folder);
  await writeJson(join(folder, 'case.json'), c);
  await writeFile(join(folder, 'assessment-summary.html'), bundle.summaryHtml, { flag: 'wx' });
  await writeFile(join(folder, 'applicant-guide.html'), bundle.applicantHtml, { flag: 'wx' });
  await writeFile(join(folder, 'vendor-guide.html'), bundle.vendorHtml, { flag: 'wx' });
  await writeJson(join(folder, 'field-values.json'), bundle.fieldValues);
  await writeJson(join(folder, 'missing-items.json'), bundle.missingItems);
  await writeJson(join(folder, 'attachment-index.json'), bundle.attachmentIndex);
  // Never auto-copy whole financial reports, never create a vendor ZIP.
  await mkdir(join(folder, 'attachments'));
  for (const [index, a] of c.attachments.entries()) {
    if (!a.verified || bundle.report.issues.some(i => i.id === `attachment:${a.attachmentId}`)) continue;
    const s = c.sources.find(s => s.sourceId === a.sourceId)!;
    const bytes = await readFile(s.path!);
    if (bytes.length !== a.bytes || bytes.length > a.maxBytes || hash(bytes) !== s.sha256) throw new Error('Attachment changed');
    if (!['pdf', 'docx', 'xlsx', 'png', 'jpg'].includes(a.format.toLowerCase())) throw new Error('Unsupported attachment format');
    await copyFile(s.path!, join(folder, 'attachments', `attachment-${index + 1}.${a.format.toLowerCase()}`));
  }
  await writeJson(join(folder, 'validation-report.json'), { ...bundle.report, inputSha256: digest, generatedAt: new Date().toISOString() });
  await rename(folder, finalFolder);
  return { folder: finalFolder, state: bundle.report.state, issueCount: bundle.report.issues.length };
}
export async function registerFile(path: string, expectedHash: string, kind: 'pdf' | 'docx') {
  const bytes = await readFile(path);
  if (hash(bytes) !== expectedHash) throw new Error('Original hash mismatch; intake stopped');
  let pageCount: number | null = null;
  if (kind === 'pdf') {
    const { getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    pageCount = pdf.numPages;
    await pdf.loadingTask.destroy();
  }
  return { path: await realpath(path), sha256: expectedHash, pageCount, kind, bytes: (await stat(path)).size };
}
