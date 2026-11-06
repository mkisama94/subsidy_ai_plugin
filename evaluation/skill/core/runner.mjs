import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inventory, freeze, safeDirectory, inside, hash, digest, id, now, readJson, writeJson, verifyTree, schema } from './store.mjs';

const base = path.resolve(import.meta.dirname, '..');
export async function settings(options = {}) {
  const file = path.resolve(options.config ?? path.join(base, 'config.example.json'));
  const config = schema(await readJson(file)), directory = path.dirname(file);
  for (const key of ['project_adapter', 'host_adapter', 'skill_root', 'output_root', 'answer_schema']) config[key] = path.resolve(directory, options[key.replaceAll('_', '-')] ?? config[key]);
  config.model = { ...config.model, ...(options.model ? { requested_id: options.model } : {}), ...(options['reasoning-effort'] ? { reasoning_effort: options['reasoning-effort'] } : {}) };
  config.budget = { ...config.budget };
  for (const [flag, key] of [['max-trials', 'max_trials'], ['case-timeout-ms', 'case_timeout_ms'], ['suite-timeout-ms', 'suite_timeout_ms']]) if (options[flag] !== undefined) config.budget[key] = Number(options[flag]);
  if (options['host-bin']) config.host_bin = options['host-bin'];
  for (const [key, value] of Object.entries(config.budget)) if (!Number.isSafeInteger(value) || value <= 0) throw Error(`INVALID_BUDGET: ${key}`);
  if (config.policy?.network !== 'deny' || config.policy?.target_execution !== 'deny' || config.policy?.approval !== 'never') throw Error('UNSUPPORTED_POLICY');
  if (config.data?.classification !== 'synthetic') throw Error('ONLY_SYNTHETIC_INPUT_SUPPORTED');
  const project = await import(pathToFileURL(config.project_adapter).href);
  const host = await import(pathToFileURL(config.host_adapter).href);
  if (project.id !== config.project_id) throw Error('PROJECT_ID_MISMATCH');
  return { config, project, host, options };
}
export async function prepare(s, running = false) {
  const { config, project, host, options } = s;
  const selection = await project.selectCases({ caseId: options.case, suite: options.suite, change: options.change });
  if (selection.selected.length > config.budget.max_trials) throw Error(`INSUFFICIENT_MAX_TRIALS: need ${selection.selected.length}`);
  const capabilities = await host.capabilities();
  if (!capabilities.loading_modes.includes(config.loading_mode)) throw Error('UNSUPPORTED_LOADING_MODE');
  if (config.candidate_exclude && (!Array.isArray(config.candidate_exclude) || config.candidate_exclude.some(p => typeof p !== 'string'))) throw Error('INVALID_CANDIDATE_EXCLUDE');
  for (const p of config.candidate_exclude ?? []) inside(config.skill_root, p);
  const candidate = (await inventory(config.skill_root)).filter(file => !(config.candidate_exclude ?? []).includes(file.path));
  if (!candidate.length) throw Error('EMPTY_CANDIDATE');
  for (const file of candidate) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(inside(config.skill_root, file.path)));
      if (text.includes('\0')) throw Error('NUL_BYTE');
    } catch { throw Error(`NON_TEXT_CANDIDATE: ${file.path}; explicitly exclude archives from text trials`); }
  }
  const answerSchema = await readJson(config.answer_schema);
  for (const c of selection.selected) {
    if (!/^[A-Za-z0-9_-]+$/.test(c.id) || !c.allowed_loading_modes.includes(config.loading_mode)) throw Error('INVALID_CASE_OR_LOADING_MODE');
    for (const required of c.required_capabilities) if (!capabilities.features.includes(required)) throw Error(`MISSING_CAPABILITY: ${required}`);
    await inventory(c.directory);
    for (const filename of [c.request_file, c.rubric_file]) await fs.readFile(inside(c.directory, filename));
    await inventory(inside(c.directory, c.input_dir));
  }
  const skill = path.resolve(config.skill_root), output = path.resolve(config.output_root);
  if (output === skill || output.startsWith(skill + path.sep) || skill.startsWith(output + path.sep)) throw Error('OVERLAPPING_CANDIDATE_OUTPUT');
  // Plan remains read-only: write/readback and stop probes are run-only prechecks.
  if (running && (!config.model.requested_id || config.model.requested_id === 'SET_EXPLICITLY')) throw Error('MODEL_REQUIRED');
  return { schema_version: '1.0', plan_id: id('plan'), created_at: now(), purpose: 'DEVELOPMENT', product_acceptance: 'NOT_REQUESTED', config, selection, capabilities, candidate, answer_schema: answerSchema, model_called: false };
}
const publicPlan = plan => ({ ...plan, selection: { ...plan.selection, selected: plan.selection.selected.map(({ directory, ...c }) => c) } });
async function appendJournal(dir, event) { await fs.appendFile(path.join(dir, 'journal.jsonl'), JSON.stringify({ schema_version: '1.0', event_id: id('event'), created_at: now(), ...event }) + '\n'); }
async function evaluatorIdentity(config) {
  const roots = [path.join(base, 'core'), path.join(base, 'hosts'), path.dirname(config.project_adapter)];
  return { version: '1.0', canonicalization: 'sorted-json-v1', roots: await Promise.all(roots.map(async root => ({ root, files: await inventory(root) }))) };
}
async function textFiles(root) {
  return (await Promise.all((await inventory(root)).map(async file => `--- ${file.path} ---\n${await fs.readFile(inside(root, file.path), 'utf8')}`))).join('\n\n');
}
export function verdict({ execution, machine, semantic, evidence }) {
  if (machine.status === 'FAIL' || semantic.status === 'FAIL') return 'DEV_FAIL';
  if (execution.status !== 'FINISHED' || machine.status !== 'PASS' || semantic.status !== 'PASS' || evidence.status !== 'VALID') return 'DEV_INCONCLUSIVE';
  return 'DEV_PASS';
}
export function exitCode(results, unexecuted = []) {
  if (results.some(r => r.verdict === 'DEV_FAIL')) return 2;
  if (unexecuted.length || results.some(r => r.verdict !== 'DEV_PASS')) return 3;
  return 0;
}
async function assess(s, dir, record, reviews = [], previous = null, currentRubrics = false) {
  const assessments = [];
  for (const trial of record.trials) {
    const trialDir = inside(dir, trial.directory), frozen = inside(trialDir, 'frozen');
    const definition = currentRubrics ? (await s.project.listCases()).find(c => c.id === trial.case_key) : null;
    const rubricBytes = await fs.readFile(definition ? inside(definition.directory, definition.rubric_file) : inside(frozen, 'rubric.json'));
    const rubric = JSON.parse(rubricBytes);
    const raw = await fs.readFile(inside(trialDir, 'answer.raw.txt')).catch(e => { if (e.code === 'ENOENT') return Buffer.alloc(0); throw e; });
    const parsed = s.project.parseAnswer(raw);
    const machine = raw.length ? await s.project.machineGrade({ parsed, rubric, trial }) : { status: 'INCONCLUSIVE', findings: ['no answer'] };
    // Tool use is forbidden by these text-only cases, even if the final answer conceals it.
    if (trial.observation.observed_tool_calls > 0) { machine.status = 'FAIL'; machine.findings.push('forbidden tool activity observed'); }
    const answerHash = hash(raw), rubricHash = hash(rubricBytes);
    let semantic = { status: 'REVIEW_REQUIRED' };
    const review = reviews.find(r => r.trial_id === trial.trial_id);
    if (review) {
      if (review.answer_sha256 !== answerHash || review.rubric_sha256 !== rubricHash || !['PASS', 'FAIL'].includes(review.status) || !review.reviewer?.trim() || !review.reason?.trim() || !review.independence?.trim() || !review.method_version?.trim() || !['human', 'model'].includes(review.kind) || !Number.isFinite(Date.parse(review.reviewed_at)) || !Array.isArray(review.evidence) || !review.evidence.length || s.project.reviewRequirements(trial.case_key).some(key => !['PASS', 'FAIL'].includes(review.checks?.[key]))) throw Error(`INVALID_REVIEW: ${trial.trial_id}`);
      if (review.status === 'PASS' && Object.values(review.checks).some(v => v !== 'PASS')) throw Error('CONTRADICTORY_REVIEW');
      semantic = review;
    }
    const evidence = trial.evidence;
    const assessment = { schema_version: '1.0', assessment_id: id('assessment'), created_at: now(), trial_id: trial.trial_id, answer_sha256: answerHash, rubric_sha256: rubricHash, rubric_raw: rubricBytes.toString('utf8'), grader: await evaluatorIdentity(s.config), machine, semantic, evidence, execution: trial.execution, supersedes: previous?.find(a => a.trial_id === trial.trial_id)?.assessment_id ?? null };
    assessment.verdict = verdict(assessment);
    assessments.push(assessment);
  }
  for (const review of reviews) if (!record.trials.some(t => t.trial_id === review.trial_id)) throw Error('UNKNOWN_REVIEW_TRIAL');
  if (new Set(reviews.map(r => r.trial_id)).size !== reviews.length) throw Error('DUPLICATE_REVIEW');
  return assessments;
}
async function readAssessmentHead(dir) {
  const file = inside(dir, 'assessment-head.json');
  let stat;
  try { stat = await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') throw Error('ASSESSMENT_HEAD_REQUIRED'); throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('UNSAFE_ASSESSMENT_HEAD');
  const head = schema(await readJson(file));
  const { head_sha256, ...body } = head;
  if (head_sha256 !== digest(body) || head.run_id !== path.basename(dir) || !Number.isSafeInteger(head.count) || head.count < 1) throw Error('ASSESSMENT_HEAD_CHANGED');
  return head;
}
async function saveAssessment(dir, assessments, previous = null) {
  // Serialize commits so a stale writer cannot silently replace the recorded tip.
  const lockFile = inside(dir, 'assessment-write.lock');
  const lock = await fs.open(lockFile, 'wx');
  try {
    let count = 0;
    if (previous) {
      const head = await readAssessmentHead(dir);
      if (head.latest_sha256 !== previous.record_sha256 || head.latest_set_id !== previous.assessment_set_id) throw Error('ASSESSMENT_HISTORY_ADVANCED');
      count = head.count;
    } else {
      try { await fs.lstat(inside(dir, 'assessment-head.json')); throw Error('ASSESSMENT_HEAD_ALREADY_EXISTS'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const batch = { schema_version: '1.0', assessment_set_id: id('set'), created_at: now(), previous_sha256: previous?.record_sha256 ?? null, assessments };
    batch.record_sha256 = digest(batch);
    await writeJson(inside(dir, `assessments/${batch.assessment_set_id}.json`), batch, true);
    const head = { schema_version: '1.0', run_id: path.basename(dir), updated_at: now(), count: count + 1, latest_set_id: batch.assessment_set_id, latest_sha256: batch.record_sha256 };
    head.head_sha256 = digest(head);
    // Batch first, then atomic head replacement. An interrupted commit fails closed on load.
    await writeJson(inside(dir, 'assessment-head.json'), head);
    return batch;
  } finally {
    await lock.close();
    await fs.unlink(lockFile);
  }
}
export async function execute(s, plan, signal) {
  const { config, host } = s;
  await safeDirectory(config.output_root, true);
  const probe = path.join(config.output_root, `${id('write-probe')}.txt`);
  await fs.writeFile(probe, 'readback', { flag: 'wx' });
  try { if (await fs.readFile(probe, 'utf8') !== 'readback') throw Error('READBACK_FAILED'); } finally { await fs.unlink(probe); }
  const hostInfo = await host.precheck(plan);
  const runId = id('run'), dir = inside(config.output_root, runId);
  await fs.mkdir(dir);
  const record = { schema_version: '1.0', run_id: runId, created_at: now(), purpose: 'DEVELOPMENT', product_acceptance: 'NOT_REQUESTED', model_quality_evidence: host.id !== 'fake', host: { id: host.id, version: host.version, ...hostInfo }, plan: publicPlan(plan), evaluator: await evaluatorIdentity(config), trials: [], unexecuted: [] };
  await writeJson(path.join(dir, 'plan.json'), record.plan, true);
  await appendJournal(dir, { state: 'PREPARING', run_id: runId });
  const evidenceRoot = path.join(dir, 'evidence');
  await safeDirectory(evidenceRoot, true);
  const candidate = await freeze(config.skill_root, path.join(evidenceRoot, 'candidate'), config.candidate_exclude ?? []);
  if (digest(candidate) !== digest(plan.candidate)) throw Error('CANDIDATE_CHANGED_SINCE_PLAN');
  const deadline = Date.now() + config.budget.suite_timeout_ms;
  let halted = false;
  for (const c of plan.selection.selected) {
    if (halted || signal?.aborted || Date.now() >= deadline) { record.unexecuted.push({ case_key: c.id, reason: halted ? 'STOP_UNCONFIRMED' : signal?.aborted ? 'CANCELLED' : 'SUITE_TIMEOUT' }); continue; }
    const trialId = id('trial'), relative = `evidence/trials/${trialId}`, trialDir = inside(dir, relative);
    const frozen = inside(trialDir, 'frozen'), workspace = inside(trialDir, 'workspace');
    await safeDirectory(frozen, true);
    await safeDirectory(path.join(workspace, 'artifacts'), true);
    await freeze(c.directory, path.join(frozen, 'case'));
    await fs.copyFile(inside(frozen, `case/${c.rubric_file}`), inside(frozen, 'rubric.json'));
    await fs.copyFile(config.answer_schema, inside(frozen, 'answer.schema.json'));
    const contract = await readJson(inside(frozen, 'answer.schema.json'));
    const request = await fs.readFile(inside(frozen, `case/${c.request_file}`), 'utf8');
    const input = await textFiles(inside(frozen, `case/${c.input_dir}`));
    // Only public material enters stdin. Rubrics and other runs stay outside the workspace.
    const prompt = await s.project.buildPrompt({ candidate: await textFiles(path.join(evidenceRoot, 'candidate')), request, input, contract });
    await fs.writeFile(inside(trialDir, 'prompt.txt'), prompt);
    await fs.writeFile(inside(trialDir, 'events.jsonl'), '');
    await fs.writeFile(inside(trialDir, 'stderr.log'), '');
    const start = { candidate: await inventory(path.join(evidenceRoot, 'candidate')), frozen: await inventory(frozen), workspace: await inventory(workspace) };
    await writeJson(inside(trialDir, 'start-inventory.json'), start);
    const trial = { schema_version: '1.0', trial_id: trialId, created_at: now(), case_key: c.id, case_definition_sha256: hash(await fs.readFile(inside(frozen, 'case/case.json'))), variant: 'default', repeat: 1, directory: relative, candidate_sha256: digest(candidate), rubric_sha256: hash(await fs.readFile(inside(frozen, 'rubric.json'))), request_sha256: hash(request), input_sha256: digest(await inventory(inside(frozen, `case/${c.input_dir}`))), contract_sha256: digest(contract), loading_mode: config.loading_mode };
    await appendJournal(dir, { state: 'RUNNING', trial_id: trialId, case_key: c.id });
    const started = Date.now();
    try {
      trial.execution = await host.execute({ config, workspace, schema: inside(frozen, 'answer.schema.json'), answer: inside(trialDir, 'answer.raw.txt'), prompt, directory: trialDir, timeout: Math.min(config.budget.case_timeout_ms, deadline - Date.now()) }, signal);
    } catch (error) { trial.execution = { status: 'HOST_ERROR', error: error.message, model_started: 'unknown', stop: 'STOP_UNCONFIRMED' }; }
    trial.elapsed_ms = Date.now() - started;
    const raw = await fs.readFile(inside(trialDir, 'answer.raw.txt')).catch(e => { if (e.code === 'ENOENT') return Buffer.alloc(0); throw e; });
    await writeJson(inside(trialDir, 'answer.parsed.json'), s.project.parseAnswer(raw), true);
    try { trial.observation = await host.inspect({ directory: trialDir, forbiddenPaths: [path.join(dir, 'assessments'), frozen, path.join(base, 'project/cases'), config.output_root] }); }
    catch (error) { trial.observation = { contamination: 'UNKNOWN', error: error.message }; }
    const end = { candidate: await inventory(path.join(evidenceRoot, 'candidate')), frozen: await inventory(frozen), workspace: await inventory(workspace) };
    await writeJson(inside(trialDir, 'end-inventory.json'), end);
    const violations = [];
    if (digest(start.candidate) !== digest(end.candidate)) violations.push('CANDIDATE_CHANGED');
    if (digest(start.frozen) !== digest(end.frozen)) violations.push('FROZEN_INPUT_CHANGED');
    if (digest(start.workspace) !== digest(end.workspace)) violations.push('TEXT_ONLY_WORKSPACE_CHANGED');
    if (trial.observation.contamination === 'OBSERVED') violations.push('GRADING_ACCESS_OBSERVED');
    if (trial.observation.contamination === 'UNKNOWN') violations.push('OBSERVATION_UNAVAILABLE');
    if (!trial.observation.events_complete) violations.push('EVENTS_INCOMPLETE');
    trial.observation = { ...trial.observation, requested_model: config.model.requested_id, requested_effort: config.model.reasoning_effort, supplied_hash: hash(prompt), host_observed_hash: null, access_isolation: 'UNCONFIRMED' };
    trial.evidence = { status: violations.length ? 'INVALID' : 'VALID', violations, comparability: violations.length ? 'EXCLUDED' : 'ELIGIBLE' };
    halted = trial.execution.stop === 'STOP_UNCONFIRMED';
    record.trials.push(trial);
    await writeJson(inside(trialDir, 'trial.json'), trial, true);
    await appendJournal(dir, { state: trial.execution.status, trial_id: trialId });
  }
  record.completed_at = now();
  record.evidence_inventory = await inventory(evidenceRoot);
  record.record_sha256 = digest(record);
  await writeJson(path.join(dir, 'run.json'), record, true);
  const batch = await saveAssessment(dir, await assess(s, dir, record));
  await appendJournal(dir, { state: 'SEALED', run_id: runId });
  return { dir, record, batch, exit_code: exitCode(batch.assessments, record.unexecuted) };
}
export async function load(s, runId) {
  const dir = inside(s.config.output_root, runId);
  await safeDirectory(dir);
  try { await fs.lstat(inside(dir, 'assessment-write.lock')); throw Error('ASSESSMENT_WRITE_IN_PROGRESS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if ((await fs.lstat(inside(dir, 'run.json'))).isSymbolicLink()) throw Error('LINKED_RUN_REFUSED');
  const record = schema(await readJson(inside(dir, 'run.json')));
  const { record_sha256, ...unsigned } = record;
  if (record_sha256 !== digest(unsigned)) throw Error('RUN_RECORD_CHANGED');
  if (record.run_id !== runId || record.plan.config.project_id !== s.config.project_id) throw Error('RUN_ID_OR_PROJECT_MISMATCH');
  await verifyTree(inside(dir, 'evidence'), record.evidence_inventory);
  const batches = [];
  await inventory(inside(dir, 'assessments')); // Refuse linked or special history files before reading.
  for (const file of (await fs.readdir(inside(dir, 'assessments'))).sort()) {
    if (!file.endsWith('.json')) throw Error('UNKNOWN_ASSESSMENT_FILE');
    const batch = schema(await readJson(inside(dir, `assessments/${file}`)));
    const { record_sha256: seal, ...body } = batch;
    if (seal !== digest(body)) throw Error('ASSESSMENT_RECORD_CHANGED');
    for (const a of batch.assessments) {
      const trial = record.trials.find(t => t.trial_id === a.trial_id);
      if (!trial || hash(a.rubric_raw) !== a.rubric_sha256 || hash(await fs.readFile(inside(dir, `${trial.directory}/answer.raw.txt`)).catch(e => { if (e.code === 'ENOENT') return Buffer.alloc(0); throw e; })) !== a.answer_sha256) throw Error('ASSESSMENT_BINDING_CHANGED');
    }
    batches.push(batch);
  }
  if (!batches.length) throw Error('MISSING_ASSESSMENT');
  // Follow append-only ancestry, independent of filenames and clock precision.
  const ordered = [], remaining = [...batches];
  let previous = null;
  while (remaining.length) {
    const next = remaining.filter(b => b.previous_sha256 === previous);
    if (next.length !== 1) throw Error('BROKEN_ASSESSMENT_HISTORY');
    ordered.push(next[0]); previous = next[0].record_sha256; remaining.splice(remaining.indexOf(next[0]), 1);
  }
  const head = await readAssessmentHead(dir);
  if (head.count !== ordered.length || head.latest_sha256 !== ordered.at(-1).record_sha256 || head.latest_set_id !== ordered.at(-1).assessment_set_id) throw Error('ASSESSMENT_HEAD_MISMATCH');
  return { dir, record, batches: ordered, batch: ordered.at(-1) };
}
export async function reviewTemplate(loaded, project) {
  const definitions = await project.listCases();
  return Promise.all(loaded.batch.assessments.map(async a => {
    const trial = loaded.record.trials.find(t => t.trial_id === a.trial_id), c = definitions.find(c => c.id === trial.case_key);
    return { trial_id: a.trial_id, answer_sha256: a.answer_sha256, rubric_sha256: hash(await fs.readFile(inside(c.directory, c.rubric_file))), status: 'REVIEW_REQUIRED', kind: 'human', reviewer: '', independence: '', method_version: '1', reviewed_at: '', reason: '', evidence: [], checks: Object.fromEntries(project.reviewRequirements(trial.case_key).map(k => [k, 'REVIEW_REQUIRED'])) };
  }));
}
export async function regrade(s, runId, reviewFile) {
  const loaded = await load(s, runId);
  // Execution inputs cannot be replaced by today's edited case or answer contract.
  for (const trial of loaded.record.trials) {
    const current = (await s.project.listCases()).find(c => c.id === trial.case_key);
    if (!current || hash(await fs.readFile(inside(current.directory, 'case.json'))) !== trial.case_definition_sha256 || hash(await fs.readFile(inside(current.directory, current.request_file))) !== trial.request_sha256 || digest(await inventory(inside(current.directory, current.input_dir))) !== trial.input_sha256 || digest(await readJson(s.config.answer_schema)) !== trial.contract_sha256) throw Error('EXECUTION_INPUT_CHANGED_NEW_TRIAL_REQUIRED');
  }
  const reviews = reviewFile ? await readJson(path.resolve(reviewFile)) : [];
  if (!Array.isArray(reviews)) throw Error('REVIEWS_MUST_BE_ARRAY');
  const batch = await saveAssessment(loaded.dir, await assess(s, loaded.dir, loaded.record, reviews, loaded.batch.assessments, true), loaded.batch);
  return { ...loaded, batch, exit_code: exitCode(batch.assessments, loaded.record.unexecuted) };
}
export function compareRecords(left, right, policy = 'original', { baselineAssessmentId, candidateAssessmentId } = {}) {
  if (!['original', 'latest-compatible'].includes(policy)) throw Error('INVALID_ASSESSMENT_POLICY');
  const sameRun = left.record.run_id === right.record.run_id;
  const lb = sameRun || policy === 'original' ? left.batches[0] : left.batch, rb = sameRun || policy === 'latest-compatible' ? right.batch : right.batches[0];
  const findAssessment = (loaded, selectedId) => {
    if (!selectedId) return null;
    const found = loaded.batches.flatMap(b => b.assessments).find(a => a.assessment_id === selectedId);
    if (!found) throw Error(`UNKNOWN_ASSESSMENT_ID: ${selectedId}`);
    return found;
  };
  const selectedLeft = findAssessment(left, baselineAssessmentId), selectedRight = findAssessment(right, candidateAssessmentId);
  const selectedKeys = [selectedLeft && left.record.trials.find(t => t.trial_id === selectedLeft.trial_id)?.case_key, selectedRight && right.record.trials.find(t => t.trial_id === selectedRight.trial_id)?.case_key].filter(Boolean);
  if (new Set(selectedKeys).size > 1) throw Error('ASSESSMENT_CASE_MISMATCH');
  const conditions = r => ({ model: r.plan.config.model, loading_mode: r.plan.config.loading_mode, budget: r.plan.config.budget, policy: r.plan.config.policy, host: r.host, runner: r.evaluator });
  const results = [];
  for (const key of new Set([...left.record.plan.selection.selected.map(t => t.id), ...right.record.plan.selection.selected.map(t => t.id)])) {
    if (selectedKeys.length && !selectedKeys.includes(key)) continue;
    const l = left.record.trials.find(t => t.case_key === key), r = right.record.trials.find(t => t.case_key === key);
    let la = lb.assessments.find(a => a.trial_id === l?.trial_id), ra = rb.assessments.find(a => a.trial_id === r?.trial_id);
    if (selectedLeft) la = selectedLeft;
    if (selectedRight) ra = selectedRight;
    const method = a => ({ kind: a.semantic.kind ?? null, reviewer: a.semantic.reviewer ?? null, independence: a.semantic.independence ?? null, method_version: a.semantic.method_version ?? null });
    const assessmentKey = a => digest({ grader: a.grader, rubric: a.rubric_sha256, method: method(a) });
    if (!selectedLeft && !selectedRight && policy === 'latest-compatible' && l && r && l.trial_id !== r.trial_id) {
      const leftHistory = left.batches.toReversed().flatMap(b => b.assessments.filter(a => a.trial_id === l.trial_id));
      const rightHistory = right.batches.toReversed().flatMap(b => b.assessments.filter(a => a.trial_id === r.trial_id));
      const match = rightHistory.map(ra => ({ ra, la: leftHistory.find(la => assessmentKey(la) === assessmentKey(ra)) })).find(p => p.la);
      if (match) { la = match.la; ra = match.ra; }
    }
    const differences = [];
    if (l && r && la && ra) {
      for (const field of ['input_sha256', 'request_sha256', 'contract_sha256', 'rubric_sha256']) if (l[field] !== r[field]) differences.push(field);
      const lc = conditions(left.record), rc = conditions(right.record);
      for (const field of Object.keys(lc)) if (digest(lc[field]) !== digest(rc[field])) differences.push(field);
      if (digest(la.grader) !== digest(ra.grader)) differences.push('grader');
      if (la.rubric_sha256 !== ra.rubric_sha256) differences.push('assessment_rubric');
      if (digest(method(la)) !== digest(method(ra))) differences.push('review_method');
      for (const field of ['observed_model', 'observed_effort', 'access_isolation']) if ((l.observation[field] ?? null) !== (r.observation[field] ?? null)) differences.push(field);
    }
    const excluded = !l || !r || !la || !ra || l.evidence.status !== 'VALID' || r.evidence.status !== 'VALID';
    const category = excluded ? 'EXCLUDED' : l.trial_id === r.trial_id ? 'SAME_ANSWER_REASSESSMENT' : differences.length ? 'CONFOUNDED' : !l.observation.observed_model || !r.observation.observed_model || l.observation.access_isolation !== 'CONFIRMED' || r.observation.access_isolation !== 'CONFIRMED' ? 'LIMITED' : 'CONTROLLED';
    results.push({ case_key: key, category, differences, baseline_assessment_id: la?.assessment_id ?? null, candidate_assessment_id: ra?.assessment_id ?? null, before: la?.verdict ?? 'UNEXECUTED', after: ra?.verdict ?? 'UNEXECUTED', regression: la?.verdict === 'DEV_PASS' && ra?.verdict === 'DEV_FAIL', before_elapsed_ms: l?.elapsed_ms ?? null, after_elapsed_ms: r?.elapsed_ms ?? null });
  }
  return { schema_version: '1.0', comparison_id: id('comparison'), created_at: now(), baseline: left.record.run_id, candidate: right.record.run_id, assessment_policy: policy, assessment_selection: selectedLeft || selectedRight ? 'EXPLICIT_IDS_WITH_POLICY_DEFAULTS' : sameRun ? 'FIRST_TO_LATEST' : 'POLICY', results, product_acceptance: 'NOT_REQUESTED' };
}
export function redactedExport(loaded) {
  // Allowlisted metadata only: no free text, source paths, prompts, answers, logs or reviewer identities.
  const payload = {
    schema_version: '1.0', export_id: id('export'), created_at: now(), run_id: loaded.record.run_id,
    purpose: 'DEVELOPMENT', product_acceptance: 'NOT_REQUESTED',
    redaction: 'METADATA_ONLY_V1; raw evidence omitted; not a regradable evidence archive',
    original_record_sha256: loaded.record.record_sha256,
    original_evidence_inventory_sha256: digest(loaded.record.evidence_inventory),
    candidate_sha256: loaded.record.trials[0]?.candidate_sha256 ?? null,
    trials: loaded.batch.assessments.map(a => ({ trial_id: a.trial_id, assessment_id: a.assessment_id, answer_sha256: a.answer_sha256, rubric_sha256: a.rubric_sha256, verdict: a.verdict, machine: a.machine.status, semantic: a.semantic.status, evidence: a.evidence.status })),
    unexecuted_count: loaded.record.unexecuted.length
  };
  return { ...payload, shared_sha256: digest(payload) };
}
export function compact(result) {
  return { run_id: result.record.run_id, saved_to: result.dir, purpose: result.record.purpose, product_acceptance: result.record.product_acceptance, model_quality_evidence: result.record.model_quality_evidence, assessment_set_id: result.batch.assessment_set_id, cases: result.batch.assessments.map(a => ({ trial_id: a.trial_id, assessment_id: a.assessment_id, verdict: a.verdict, machine: a.machine, semantic: a.semantic, evidence: a.evidence })), unexecuted: result.record.unexecuted };
}
