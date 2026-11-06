import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { settings, prepare, execute, load, regrade, reviewTemplate, compareRecords, redactedExport } from '../core/runner.mjs';
import { freeze, inventory, inside, readJson, writeJson, digest } from '../core/store.mjs';
import { hostArgs, runHost, probeTreeTermination } from '../hosts/process.mjs';
const base = path.resolve(import.meta.dirname, '..');
const exec = promisify(execFile);

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subsidy-skill-eval-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(base, 'project'), path.join(root, 'project'), { recursive: true });
  // Adapter's relative core import remains in a separate, trusted module tree.
  await fs.cp(path.join(base, 'core'), path.join(root, 'core'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills'));
  await fs.writeFile(path.join(root, 'skills', 'SKILL.md'), 'fixture candidate v1');
  const config = { ...await readJson(path.join(base, 'config.example.json')), project_adapter: './project/adapter.mjs', host_adapter: path.join(base, 'tests/fake-host.mjs'), skill_root: './skills', output_root: './results', answer_schema: './project/schemas/answer.schema.json', model: { requested_id: 'fixture-only', reasoning_effort: null }, ...options.config };
  await writeJson(path.join(root, 'config.json'), config);
  const s = await settings({ config: path.join(root, 'config.json'), case: 'C001', ...options.cli });
  return { root, s, config, run: async () => execute(s, await prepare(s, true)) };
}
async function reviewsFor(loaded, project, status = 'PASS') {
  return (await reviewTemplate(loaded, project)).map(r => ({ ...r, status, kind: 'human', reviewer: 'fixture reviewer (not a quality review)', independence: 'test fixture', method_version: 'fixture-1', reviewed_at: new Date().toISOString(), reason: 'test-only review', evidence: ['response:1'], checks: { correctness: status, scope: 'PASS', evidence: 'PASS' } }));
}
async function reviewed(f, run, status = 'PASS') {
  const loaded = await load(f.s, run.record.run_id), file = path.join(f.root, 'reviews.json');
  await writeJson(file, await reviewsFor(loaded, f.s.project, status));
  return regrade(f.s, run.record.run_id, file);
}

test('A01 plan does not create output or call host/model', async t => {
  const f = await fixture(t);
  let calls = 0; f.s.host = { ...f.s.host, precheck: () => { calls++; }, execute: () => { calls++; } };
  const p = await prepare(f.s);
  assert.equal(p.model_called, false); assert.equal(calls, 0);
  await assert.rejects(fs.access(path.join(f.root, 'results')));
});
test('A02 model, missing reference, budget and capabilities fail before execute', async t => {
  const f = await fixture(t); f.s.config.model.requested_id = 'SET_EXPLICITLY';
  await assert.rejects(prepare(f.s, true), /MODEL_REQUIRED/);
  f.s.config.model.requested_id = 'fixture-only';
  await fs.unlink(path.join(f.root, 'project/cases/C001/request.txt'));
  await assert.rejects(prepare(f.s, true), /ENOENT/);
  const b = await fixture(t, { cli: { case: undefined, suite: 'all' } });
  await assert.rejects(prepare(b.s), /INSUFFICIENT_MAX_TRIALS/);
  const c = await fixture(t); c.s.host = { ...c.s.host, capabilities: async () => ({ loading_modes: ['supplied_candidate_text'], features: [] }) };
  await assert.rejects(prepare(c.s), /MISSING_CAPABILITY/);
});
test('A03 snapshot is unaffected by source edits during a trial; grading data absent from prompt', async t => {
  const f = await fixture(t); const host = f.s.host;
  f.s.host = { ...host, execute: async input => {
    await fs.writeFile(path.join(f.root, 'skills/SKILL.md'), 'changed original');
    assert.match(input.prompt, /fixture candidate v1/);
    assert.doesNotMatch(input.prompt, /allowed_sources|review_checks|alternatives/);
    assert.deepEqual(await fs.readdir(input.workspace), ['artifacts']);
    return host.execute(input);
  } };
  const r = await f.run(); assert.equal(r.record.trials[0].evidence.status, 'VALID');
  assert.equal(await fs.readFile(path.join(r.dir, 'evidence/candidate/SKILL.md'), 'utf8'), 'fixture candidate v1');
});
test('A04 mutation and contamination remain excluded after regrade', async t => {
  const f = await fixture(t), host = f.s.host;
  f.s.host = { ...host, execute: async input => {
    await fs.writeFile(path.join(input.workspace, 'changed.txt'), 'tamper');
    return host.execute(input);
  }, inspect: async () => ({ ...await host.inspect(), contamination: 'OBSERVED' }) };
  const r = await f.run(), after = await reviewed(f, r);
  assert.equal(after.batch.assessments[0].verdict, 'DEV_INCONCLUSIVE');
  assert.ok(after.record.trials[0].evidence.violations.includes('GRADING_ACCESS_OBSERVED'));
});
for (const mutation of ['add', 'remove', 'change']) test(`A05 evidence ${mutation} refuses regrading`, async t => {
  const f = await fixture(t), r = await f.run(), file = path.join(r.dir, 'evidence/candidate/SKILL.md');
  if (mutation === 'add') await fs.writeFile(path.join(r.dir, 'evidence/extra.txt'), 'x');
  if (mutation === 'remove') await fs.unlink(file);
  if (mutation === 'change') await fs.writeFile(file, 'x');
  await assert.rejects(regrade(f.s, r.record.run_id), /EVIDENCE_CHANGED/);
});
test('A06 rubric/grader regrade appends; old records and answers remain unchanged', async t => {
  const f = await fixture(t), r = await f.run();
  const before = await fs.readFile(path.join(r.dir, 'run.json'));
  const rubricFile = path.join(f.root, 'project/cases/C001/rubric.json'), rubric = await readJson(rubricFile);
  rubric.alternatives.push('new permitted alternative'); await writeJson(rubricFile, rubric);
  const regraded = await reviewed(f, r);
  assert.equal(regraded.batch.assessments[0].verdict, 'DEV_PASS');
  assert.notEqual(regraded.batch.assessments[0].rubric_sha256, r.batch.assessments[0].rubric_sha256);
  const loaded = await load(f.s, r.record.run_id);
  assert.equal(loaded.batches.length, 2);
  assert.equal(loaded.batches[0].assessments[0].verdict, 'DEV_INCONCLUSIVE');
  assert.deepEqual(await fs.readFile(path.join(r.dir, 'run.json')), before);
  assert.equal(r.record.model_quality_evidence, false);
});
for (const file of ['project/cases/C001/request.txt', 'project/cases/C001/input/sources.txt', 'project/schemas/answer.schema.json', 'project/cases/C001/case.json']) test(`A07 changed execution input refuses regrade: ${file}`, async t => {
  const f = await fixture(t), r = await f.run();
  if (file.endsWith('.json')) { const data = await readJson(path.join(f.root, file)); data.changed = true; await writeJson(path.join(f.root, file), data); }
  else await fs.appendFile(path.join(f.root, file), 'changed');
  await assert.rejects(regrade(f.s, r.record.run_id), /EXECUTION_INPUT_CHANGED/);
});
test('A08 machine PASS awaits semantic review; A09 semantic FAIL is decisive', async t => {
  const f = await fixture(t), r = await f.run();
  assert.equal(r.batch.assessments[0].machine.status, 'PASS');
  assert.equal(r.batch.assessments[0].verdict, 'DEV_INCONCLUSIVE'); assert.equal(r.exit_code, 3);
  const rr = await reviewed(f, r, 'FAIL'); assert.equal(rr.exit_code, 2);
  assert.equal(rr.batch.assessments[0].verdict, 'DEV_FAIL');
});
test('A10 unconfirmed stop prevents later trials and keeps logs', async t => {
  const f = await fixture(t, { cli: { case: undefined, suite: 'all', 'max-trials': '4' } });
  f.s.host = { ...f.s.host, execute: async () => ({ status: 'TIMED_OUT', stop: 'STOP_UNCONFIRMED', model_started: false }) };
  const r = await f.run(); assert.equal(r.record.trials.length, 1); assert.equal(r.record.unexecuted.length, 3);
  assert.equal(r.exit_code, 3); assert.match(await fs.readFile(path.join(r.dir, 'journal.jsonl'), 'utf8'), /TIMED_OUT/);
});
test('A12 comparison distinguishes condition drift, unknown observations and same trial', async t => {
  const f = await fixture(t), a = await f.run(), b = await f.run();
  let left = await load(f.s, a.record.run_id), right = await load(f.s, b.record.run_id);
  assert.equal(compareRecords(left, right).results[0].category, 'LIMITED');
  right.record.plan.config.model.requested_id = 'different';
  assert.equal(compareRecords(left, right).results[0].category, 'CONFOUNDED');
  await reviewed(f, a);
  right = await load(f.s, a.record.run_id);
  assert.equal(compareRecords(left, right, 'latest-compatible').results[0].category, 'SAME_ANSWER_REASSESSMENT');
});
test('A14 unknown change selects complete small suite; A15 path/tool loading refused', async t => {
  const f = await fixture(t, { cli: { case: undefined, suite: 'affected', change: 'unknown-tag', 'max-trials': '4' } });
  assert.equal((await prepare(f.s)).selection.selected.length, 4);
  f.s.config.loading_mode = 'explicit_candidate_path';
  await assert.rejects(prepare(f.s), /UNSUPPORTED_LOADING_MODE/);
});
test('A16 fabricated save claim/action fails machine or semantic review; known fail survives timeout', async t => {
  const f = await fixture(t);
  f.s.host = { ...f.s.host, execute: async input => {
    await fs.writeFile(input.answer, JSON.stringify({ response: '保存しました', sources: [], actions: ['save'] }));
    return { status: 'TIMED_OUT', stop: 'CONFIRMED', model_started: false };
  } };
  const r = await f.run(); assert.equal(r.exit_code, 2);
  assert.equal(r.batch.assessments[0].verdict, 'DEV_FAIL');
});
test('A17 production source and release script do not depend on evaluation', async () => {
  const repo = path.resolve(base, '../..');
  for (const root of ['src', 'plugins/subsidy-ai', 'releases/subsidy-ai-1.1.0']) {
    for (const file of await inventory(path.join(repo, root))) if (/\.(ts|mjs|js|json|md)$/.test(file.path)) assert.doesNotMatch(await fs.readFile(inside(path.join(repo, root), file.path), 'utf8'), /(?:import|require|from).*evaluation\/skill/);
  }
  assert.doesNotMatch(await fs.readFile(path.join(repo, 'scripts/build-review-release.mjs'), 'utf8'), /evaluation\/skill/);
});
test('A18 pass remains DEVELOPMENT with acceptance NOT_REQUESTED; A19 unknown schema rejected', async t => {
  const f = await fixture(t), r = await f.run(), rr = await reviewed(f, r);
  assert.equal(rr.record.product_acceptance, 'NOT_REQUESTED'); assert.equal(rr.record.purpose, 'DEVELOPMENT');
  const record = await readJson(path.join(r.dir, 'run.json')); record.schema_version = '99.0'; await writeJson(path.join(r.dir, 'run.json'), record);
  await assert.rejects(load(f.s, r.record.run_id), /UNSUPPORTED_SCHEMA/);
});
test('A20 second project/answer contract runs without core business branches', async t => {
  const f = await fixture(t);
  f.s.project = { ...f.s.project, parseAnswer: raw => ({ status: 'PASS', answer: { count: Number(raw.toString()) } }), machineGrade: async ({ parsed }) => ({ status: parsed.answer.count === 7 ? 'PASS' : 'FAIL', findings: [] }) };
  f.s.host = { ...f.s.host, execute: async input => { await fs.writeFile(input.answer, '7'); return { status: 'FINISHED', stop: 'NOT_REQUESTED', model_started: false }; } };
  const r = await f.run(); assert.equal(r.batch.assessments[0].machine.status, 'PASS');
});
test('reviews must bind to answer/rubric and name their method, reviewer and evidence', async t => {
  const f = await fixture(t), r = await f.run(), loaded = await load(f.s, r.record.run_id);
  const reviews = await reviewsFor(loaded, f.s.project); reviews[0].answer_sha256 = 'wrong';
  const file = path.join(f.root, 'review.json'); await writeJson(file, reviews);
  await assert.rejects(regrade(f.s, r.record.run_id, file), /INVALID_REVIEW/);
});
test('history and run metadata tampering detected', async t => {
  const f = await fixture(t), r = await f.run(), file = path.join(r.dir, 'assessments', `${r.batch.assessment_set_id}.json`);
  const batch = await readJson(file); batch.assessments[0].verdict = 'DEV_PASS'; await writeJson(file, batch);
  await assert.rejects(load(f.s, r.record.run_id), /ASSESSMENT_RECORD_CHANGED/);
});
test('path traversal, links and case collisions refused', async t => {
  assert.throws(() => inside('/tmp', '../escape')); assert.throws(() => inside('/tmp', 'C:/escape')); assert.throws(() => inside('/tmp', 'a\\b'));
  const f = await fixture(t), target = path.join(f.root, 'link');
  try { await fs.symlink(path.join(f.root, 'skills'), target, 'junction'); }
  catch (e) { if (['EPERM','EACCES'].includes(e.code)) { t.diagnostic('link creation unavailable on this host'); return; } throw e; }
  await assert.rejects(inventory(target), /UNSAFE_DIRECTORY/);
});
test('Codex args disable inherited connections and automatic approvals', () => {
  const args = hostArgs({ workspace: '/tmp', model: 'explicit', schema: '/schema', answer: '/answer', suppliedText: true });
  assert.ok(args.includes('read-only')); assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('mcp_servers={}'));
  assert.ok(args.includes('web_search="disabled"')); assert.ok(!args.includes('--approve-for-me'));
});
test('disposable actual process tree stop probe and timeout preserve stdout', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const probe = await probeTreeTermination(); assert.equal(probe.status, 'CONFIRMED_ON_PROBE');
  const dir = path.join(f.root, 'process'); await fs.mkdir(dir);
  const result = await runHost({ binary: process.execPath, args: ['-e', 'console.log("started");setInterval(()=>{},1000)'], workspace: dir, prompt: '', directory: dir, timeout: 200 });
  assert.equal(result.status, 'TIMED_OUT'); assert.equal(result.stop_error, null);
  assert.match(await fs.readFile(path.join(dir, 'events.jsonl'), 'utf8'), /started/);
});
test('CLI plan and invalid options have documented exit codes', async t => {
  const f = await fixture(t);
  const good = await exec(process.execPath, [path.join(base, 'cli.mjs'), 'plan', '--config', path.join(f.root, 'config.json'), '--case', 'C001']);
  assert.equal(JSON.parse(good.stdout).model_called, false);
  await assert.rejects(exec(process.execPath, [path.join(base, 'cli.mjs'), 'plan', '--unknown']), e => e.code === 4);
});
test('precheck failure and output link rejection never start a model', async t => {
  const f = await fixture(t); let calls = 0;
  f.s.host = { ...f.s.host, precheck: async () => { throw Error('STOP_UNAVAILABLE'); }, execute: async () => { calls++; } };
  await assert.rejects(f.run(), /STOP_UNAVAILABLE/); assert.equal(calls, 0);
  f.s.config.output_root = path.join(f.root, 'skills');
  await assert.rejects(prepare(f.s), /OVERLAPPING_CANDIDATE_OUTPUT/);
});
test('forbidden tool activity fails and incomplete observation cannot pass', async t => {
  const f = await fixture(t), host = f.s.host;
  f.s.host = { ...host, inspect: async () => ({ ...await host.inspect(), observed_tool_calls: 1 }) };
  const r = await f.run(); assert.equal(r.exit_code, 2);
  f.s.host = { ...host, inspect: async () => ({ ...await host.inspect(), events_complete: false }) };
  const rr = await f.run(), reviewedRun = await reviewed(f, rr);
  assert.equal(reviewedRun.batch.assessments[0].verdict, 'DEV_INCONCLUSIVE');
});
test('redacted export omits text/paths and includes separate original and shared hashes', async t => {
  const f = await fixture(t), r = await f.run(), loaded = await load(f.s, r.record.run_id);
  const exported = redactedExport(loaded), text = JSON.stringify(exported);
  assert.doesNotMatch(text, /固定回答|fixture candidate|fixture-only|reviewer|results\\|C001/);
  assert.equal(exported.original_record_sha256, loaded.record.record_sha256);
  const { shared_sha256, ...payload } = exported; assert.equal(shared_sha256, digest(payload));
});
test('latest-compatible finds matching historical grading instead of mixing rubric versions', async t => {
  const f = await fixture(t), a = await f.run(), b = await f.run();
  const rubricFile = path.join(f.root, 'project/cases/C001/rubric.json'), rubric = await readJson(rubricFile);
  rubric.version = '2'; await writeJson(rubricFile, rubric);
  await regrade(f.s, b.record.run_id);
  const left = await load(f.s, a.record.run_id), right = await load(f.s, b.record.run_id);
  const comparison = compareRecords(left, right, 'latest-compatible');
  assert.equal(comparison.results[0].category, 'LIMITED');
  assert.equal(comparison.results[0].candidate_assessment_id, right.batches[0].assessments[0].assessment_id);
});
test('recover records interruption without creating missing end evidence or invoking a model', async t => {
  const f = await fixture(t), dir = path.join(f.root, 'results', 'run-interrupted');
  await fs.mkdir(dir, { recursive: true }); await writeJson(path.join(dir, 'plan.json'), { status: 'incomplete' });
  await assert.rejects(exec(process.execPath, [path.join(base, 'cli.mjs'), 'recover', 'run-interrupted', '--config', path.join(f.root, 'config.json')]), e => {
    const result = JSON.parse(e.stdout); return e.code === 3 && result.model_called === false && result.stop === 'STOP_UNCONFIRMED';
  });
  await assert.rejects(fs.access(path.join(dir, 'run.json')));
});
test('binary archives are explicitly excluded from text candidates; unexpected binary fails plan', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'skills/subsidy-consultation.zip'), Buffer.from([0xff, 0x00, 0xfe]));
  const plan = await prepare(f.s); assert.equal(plan.candidate.length, 1);
  const r = await f.run(); assert.deepEqual(await fs.readdir(path.join(r.dir, 'evidence/candidate')), ['SKILL.md']);
  await fs.writeFile(path.join(f.root, 'skills/unexpected.bin'), Buffer.from([0xff, 0x00, 0xfe]));
  await assert.rejects(prepare(f.s), /NON_TEXT_CANDIDATE/);
});
test('candidate changes between planning and freezing are rejected before host execution', async t => {
  const f = await fixture(t), plan = await prepare(f.s, true);
  await fs.writeFile(path.join(f.root, 'skills/SKILL.md'), 'new candidate after plan');
  let calls = 0;
  f.s.host = { ...f.s.host, execute: async () => { calls++; } };
  await assert.rejects(execute(f.s, plan), /CANDIDATE_CHANGED_SINCE_PLAN/);
  assert.equal(calls, 0);
});

for (const removedCount of [1, 2]) test(`latest ${removedCount} assessment deletion cannot roll a FAIL back to PASS`, async t => {
  const f = await fixture(t), r = await f.run();
  await reviewed(f, r, 'PASS');
  await reviewed(f, r, 'PASS');
  await reviewed(f, r, 'FAIL');
  const loaded = await load(f.s, r.record.run_id);
  assert.equal(loaded.batch.assessments[0].verdict, 'DEV_FAIL');
  const anchorFile = path.join(r.dir, 'assessment-head.json'), anchorBytes = await fs.readFile(anchorFile);
  const head = await readJson(anchorFile);
  assert.equal(head.count, 4); assert.equal(head.latest_sha256, loaded.batch.record_sha256);
  for (const batch of loaded.batches.slice(-removedCount)) await fs.unlink(path.join(r.dir, 'assessments', `${batch.assessment_set_id}.json`));
  await assert.rejects(load(f.s, r.record.run_id), /ASSESSMENT_HEAD_MISMATCH/);
  await assert.rejects(regrade(f.s, r.record.run_id), /ASSESSMENT_HEAD_MISMATCH/);
  await assert.rejects(exec(process.execPath, [path.join(base, 'cli.mjs'), 'show', r.record.run_id, '--config', path.join(f.root, 'config.json')]), e => e.code === 4 && JSON.parse(e.stderr).error === 'ASSESSMENT_HEAD_MISMATCH');
  assert.deepEqual(await fs.readFile(anchorFile), anchorBytes);
});
test('missing head is rejected rather than reconstructing history from remaining files', async t => {
  const f = await fixture(t), r = await f.run();
  await fs.unlink(path.join(r.dir, 'assessment-head.json'));
  await assert.rejects(load(f.s, r.record.run_id), /ASSESSMENT_HEAD_REQUIRED/);
  await assert.rejects(regrade(f.s, r.record.run_id), /ASSESSMENT_HEAD_REQUIRED/);
  await assert.rejects(fs.access(path.join(r.dir, 'assessment-head.json')));
});
test('uncommitted suffix and in-progress writer fail closed', async t => {
  const f = await fixture(t), r = await f.run(), originalHead = await fs.readFile(path.join(r.dir, 'assessment-head.json'));
  await reviewed(f, r, 'FAIL');
  await fs.writeFile(path.join(r.dir, 'assessment-head.json'), originalHead);
  await assert.rejects(load(f.s, r.record.run_id), /ASSESSMENT_HEAD_MISMATCH/);
  await fs.writeFile(path.join(r.dir, 'assessment-write.lock'), '');
  await assert.rejects(load(f.s, r.record.run_id), /ASSESSMENT_WRITE_IN_PROGRESS/);
});
for (const policy of ['original', 'latest-compatible']) test(`CLI same-run ${policy} compares first to latest and allows explicit PASS to FAIL`, async t => {
  const f = await fixture(t), r = await f.run(), passed = await reviewed(f, r, 'PASS'), failed = await reviewed(f, r, 'FAIL');
  const baseline = passed.batch.assessments[0].assessment_id, candidate = failed.batch.assessments[0].assessment_id;
  const args = [path.join(base, 'cli.mjs'), 'compare', r.record.run_id, r.record.run_id, '--config', path.join(f.root, 'config.json'), '--assessment-policy', policy];
  const compareCli = async extra => {
    try { await exec(process.execPath, [...args, ...extra]); assert.fail('FAIL comparison must exit 2'); }
    catch (e) { assert.equal(e.code, 2); return JSON.parse(e.stdout); }
  };
  const defaultResult = await compareCli([]), defaultRow = defaultResult.results[0];
  assert.equal(defaultResult.assessment_selection, 'FIRST_TO_LATEST');
  assert.equal(defaultRow.baseline_assessment_id, r.batch.assessments[0].assessment_id);
  assert.equal(defaultRow.candidate_assessment_id, candidate);
  assert.equal(defaultRow.before, 'DEV_INCONCLUSIVE'); assert.equal(defaultRow.after, 'DEV_FAIL');
  const explicit = await compareCli(['--baseline-assessment', baseline, '--candidate-assessment', candidate]);
  const row = explicit.results[0];
  assert.equal(row.category, 'SAME_ANSWER_REASSESSMENT');
  assert.equal(row.baseline_assessment_id, baseline); assert.equal(row.candidate_assessment_id, candidate);
  assert.notEqual(row.baseline_assessment_id, row.candidate_assessment_id);
  assert.equal(row.before, 'DEV_PASS'); assert.equal(row.after, 'DEV_FAIL'); assert.equal(row.regression, true);
  const stored = await readJson(path.join(r.dir, 'comparisons', `${explicit.comparison_id}.json`));
  assert.deepEqual(stored, explicit);
  const shown = await exec(process.execPath, [path.join(base, 'cli.mjs'), 'show', r.record.run_id, '--config', path.join(f.root, 'config.json')]).catch(e => { assert.equal(e.code, 2); return e; });
  assert.equal(JSON.parse(shown.stdout).cases[0].assessment_id, candidate);
});
test('CLI rejects unknown assessment IDs and assessment IDs belonging to different cases', async t => {
  const f = await fixture(t, { cli: { case: undefined, suite: 'all', 'max-trials': '4' } }), r = await f.run();
  const args = [path.join(base, 'cli.mjs'), 'compare', r.record.run_id, r.record.run_id, '--config', path.join(f.root, 'config.json')];
  await assert.rejects(exec(process.execPath, [...args, '--baseline-assessment', 'missing']), e => e.code === 4 && JSON.parse(e.stderr).error.includes('UNKNOWN_ASSESSMENT_ID'));
  await assert.rejects(exec(process.execPath, [...args, '--baseline-assessment', r.batch.assessments[0].assessment_id, '--candidate-assessment', r.batch.assessments[1].assessment_id]), e => e.code === 4 && JSON.parse(e.stderr).error === 'ASSESSMENT_CASE_MISMATCH');
});
