import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { privateRoot, writePackage, registerFile, hash } from '../../scripts/application-assist/storage';
import { createDraft } from '../../src/applicationAssist/draft';

test('A01/A12 local intake fails closed and exports only outside repository', async () => {
  const previous = process.env.SUBSIDY_ASSIST_PRIVATE_DIR;
  const root = await mkdtemp(join(tmpdir(), 'subsidy-assist-test-'));
  try {
    delete process.env.SUBSIDY_ASSIST_PRIVATE_DIR; await assert.rejects(privateRoot);
    process.env.SUBSIDY_ASSIST_PRIVATE_DIR = resolve('tmp/forbidden-assist'); await assert.rejects(privateRoot);
    process.env.SUBSIDY_ASSIST_PRIVATE_DIR = root;
    const result = await writePackage(createDraft('SYNTHETIC-IO', 'SYNTHETIC-CO', 'synthetic_test', '2026-11-07'));
    assert.equal(result.state, 'needsInformation');
    assert.ok((await readFile(join(result.folder, 'applicant-guide.html'), 'utf8')).includes('未完成'));
    assert.deepEqual(await readdir(join(result.folder, 'attachments')), []);
    assert.ok(!result.folder.includes('.pending-')); assert.ok(!(await readdir(root)).some(p => p.startsWith('.pending-')));
    const original = join(root, 'synthetic.docx'); await writeFile(original, 'synthetic-only');
    await assert.rejects(() => registerFile(original, 'b'.repeat(64), 'docx'));
    const registered = await registerFile(original, hash('synthetic-only'), 'docx'); assert.equal(registered.sha256, hash('synthetic-only'));
  } finally {
    if (previous === undefined) delete process.env.SUBSIDY_ASSIST_PRIVATE_DIR; else process.env.SUBSIDY_ASSIST_PRIVATE_DIR = previous;
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\') || resolve(root).startsWith(resolve(tmpdir()) + '/'));
    await rm(root, { recursive: true, force: true });
  }
});
