import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync, unzipSync } from 'fflate';
import { parse as parseYaml } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const statuses = new Set(['pending', 'retrieved', 'contentChecked', 'conflict', 'expired']);
export function validatePublicProfile(p) {
  if (p.schemaVersion !== '1' || !p.vendorKey || !p.profileVersion || Object.hasOwn(p, 'verified')) throw Error('PROFILE_IDENTITY');
  const ids = new Set(p.sources.map(s => s.sourceId));
  if (ids.size !== p.sources.length) throw Error('DUPLICATE_SOURCE');
  for (const s of p.sources) if (!/^https:\/\//.test(s.url) || !s.publisher || !s.headings?.length || !statuses.has(s.status)) throw Error('PROFILE_SOURCE');
  const stepIds = new Set(p.workflowSteps.map(s => s.stepId));
  if (stepIds.size !== p.workflowSteps.length) throw Error('DUPLICATE_STEP');
  for (const s of p.workflowSteps) {
    if (!s.actor || !s.requiredInputs?.length || !s.output || !s.completionEvidence?.length || [...s.prerequisites, ...s.downstream].some(id => !stepIds.has(id))) throw Error('WORKFLOW_DEPENDENCY');
  }
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if ('status' in value) {
      if (!statuses.has(value.status)) throw Error('UNKNOWN_STATUS');
      if ('sourceId' in value && value.sourceId !== null && !ids.has(value.sourceId)) throw Error('UNKNOWN_SOURCE');
      if (value.status === 'contentChecked' && (!value.checkedAt || !Number.isFinite(Date.parse(value.checkedAt)))) throw Error('MISSING_CHECK_TIME');
      if ('value' in value && value.status === 'contentChecked' && (!value.sourceId || value.value === null)) throw Error('MISSING_FACT_EVIDENCE');
      if ('value' in value && !Object.hasOwn(value, 'applicableYear')) throw Error('MISSING_APPLICABLE_YEAR');
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(p);
  return p;
}
export async function collectSkills(source = path.join(root, 'plugins/subsidy-ai/skills')) {
  const files = {};
  for (const name of ['company-research', 'subsidy-consultation', 'pca-it-application-assist']) {
    async function walk(folder, prefix) {
      for (const item of (await fs.readdir(folder)).sort()) {
        const file = path.join(folder, item), stat = await fs.lstat(file), relative = `${prefix}/${item}`;
        if (stat.isSymbolicLink()) throw Error('PACKAGE_LINK_REFUSED');
        if (stat.isDirectory()) await walk(file, relative);
        else if (/\.(md|json)$/.test(item)) files[relative] = new Uint8Array(await fs.readFile(file));
      }
    }
    await walk(path.join(source, name), `skills/${name}`);
  }
  validateSkillFiles(files);
  return files;
}
export function validateSkillFiles(files) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const [file, bytes] of Object.entries(files)) {
    const text = decoder.decode(bytes);
    if (text.includes('\0')) throw Error('NON_TEXT_SKILL');
    if (file.endsWith('.json')) JSON.parse(text);
    if (file.endsWith('/SKILL.md')) {
      const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1];
      const metadata = front ? parseYaml(front) : null;
      if (!metadata || typeof metadata.name !== 'string' || !/^[a-z0-9-]+$/.test(metadata.name) || typeof metadata.description !== 'string' || !metadata.description.trim() || bytes.length > 1_048_576) throw Error('SKILL_FRONTMATTER');
    }
    if (!file.endsWith('.md')) continue;
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const url = match[1];
      if (/^(https?:|#)/.test(url)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), url.split('#')[0]));
      if (!target.startsWith('skills/') || !files[target]) throw Error(`BROKEN_SKILL_REFERENCE: ${file} -> ${url}`);
    }
  }
  const profile = JSON.parse(decoder.decode(files['skills/pca-it-application-assist/references/vendors/mimosa.json']));
  validatePublicProfile(profile);
}
export async function buildCandidate() {
  const files = await collectSkills();
  const inventory = Object.entries(files).map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: sha(bytes) }));
  const sourceDigest = sha(JSON.stringify(inventory));
  const folder = path.join(root, 'output', `vendor-workflow-candidate-${sourceDigest.slice(0, 12)}`);
  await fs.mkdir(folder, { recursive: true });
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, [bytes, { mtime: new Date('2026-11-07T00:00:00Z') }]])), { level: 9 });
  const unpacked = unzipSync(zip);
  if (JSON.stringify(Object.keys(unpacked).sort()) !== JSON.stringify(Object.keys(files).sort()) || inventory.some(i => sha(unpacked[i.file]) !== i.sha256)) throw Error('ARCHIVE_MISMATCH');
  await fs.writeFile(path.join(folder, 'skills-update-candidate.zip'), zip);
  for (const [file, bytes] of Object.entries(files)) { const dest = path.join(folder, file); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, bytes); }
  const base = JSON.parse(await fs.readFile(path.join(root, 'releases/subsidy-ai-1.1.0/.codex-plugin/plugin.json'), 'utf8'));
  const check = { createdAt: new Date().toISOString(), kind: 'partial-skills-update-candidate', sourceDigest, archiveSha256: sha(zip), inventory,
    recordedRelease: { identifier: base.name, version: base.version }, targetConfirmed: false, proposedVersion: null,
    manifestIncluded: false, mcpConfigurationIncluded: false, archiveReadback: 'passed', sourceLinks: 'passed',
    realModelEvaluation: 'see separate evaluation records; not implied by package check', installedHostAcceptance: 'not_run', published: false,
    limitation: '更新用のスキル差分。単体プラグインではない。更新先・次版番号・実ホストの読み込みを別途確認。既存リリース・設定・権限を変更しない。' };
  await fs.writeFile(path.join(folder, 'package-check.json'), JSON.stringify(check, null, 2) + '\n');
  return { folder, sourceDigest, archiveSha256: check.archiveSha256, files: inventory.length, installedHostAcceptance: 'not_run' };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(await buildCandidate(), null, 2));
