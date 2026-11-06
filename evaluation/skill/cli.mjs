import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import { settings, prepare, execute, load, regrade, reviewTemplate, compareRecords, compact, exitCode, redactedExport } from './core/runner.mjs';
import { inside, writeJson, id, now, inventory, safeDirectory } from './core/store.mjs';

const strings = ['config', 'case', 'suite', 'change', 'model', 'reasoning-effort', 'skill-root', 'output-root', 'host-bin', 'max-trials', 'case-timeout-ms', 'suite-timeout-ms', 'reviews', 'assessment-policy', 'baseline-assessment', 'candidate-assessment', 'compare', 'output'];
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { ...Object.fromEntries(strings.map(k => [k, { type: 'string' }])), help: { type: 'boolean' }, redacted: { type: 'boolean' } } });
  const [command = 'plan', first, second] = positionals;
  if (values.help) {
    console.log('npm run eval:skill -- plan|run --case C001 [--model ID]\nplan|run --suite all|affected --change TAG --max-trials N\nshow RUN_ID\nreview-template RUN_ID\nregrade RUN_ID --reviews FILE\ncompare BASELINE CANDIDATE --assessment-policy original|latest-compatible\n  [--baseline-assessment ASSESSMENT_ID] [--candidate-assessment ASSESSMENT_ID]\n  Same run: first to latest by default. Explicit IDs select their matching case.\nrecover RUN_ID\nexport RUN_ID --redacted --output DIRECTORY\nOnly run invokes a model. DEVELOPMENT; product acceptance is separate.');
  } else {
    if (!['plan', 'run', 'show', 'review-template', 'regrade', 'compare', 'recover', 'export'].includes(command)) throw Error('UNKNOWN_COMMAND');
    if (positionals.length !== (['plan', 'run'].includes(command) ? 1 : command === 'compare' ? 3 : 2)) throw Error('INVALID_ARGUMENT_COUNT');
    const s = await settings(values);
    const assessmentSelection = { baselineAssessmentId: values['baseline-assessment'], candidateAssessmentId: values['candidate-assessment'] };
    if ((assessmentSelection.baselineAssessmentId || assessmentSelection.candidateAssessmentId) && command !== 'compare') throw Error('ASSESSMENT_IDS_REQUIRE_COMPARE');
    let result;
    if (command === 'plan' || command === 'run') {
      if (first || second) throw Error('UNEXPECTED_ARGUMENT');
      const plan = await prepare(s, command === 'run');
      if (command === 'plan') result = plan;
      else {
        const controller = new AbortController(), cancel = () => controller.abort();
        process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
        try {
          const run = await execute(s, plan, controller.signal);
          result = compact(run); process.exitCode = run.exit_code;
          if (values.compare) {
            const comparison = compareRecords(await load(s, values.compare), await load(s, run.record.run_id), values['assessment-policy']);
            await writeJson(inside(run.dir, `comparisons/${comparison.comparison_id}.json`), comparison, true);
            result.comparison = comparison;
          }
        } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
      }
    } else if (command === 'export') {
      if (!values.redacted || !values.output) throw Error('EXPORT_REQUIRES_REDACTED_AND_OUTPUT');
      const run = await load(s, first), directory = path.resolve(values.output);
      if (directory === run.dir || directory.startsWith(run.dir + path.sep)) throw Error('EXPORT_MUST_BE_OUTSIDE_RUN');
      await safeDirectory(directory, true);
      result = redactedExport(run);
      await writeJson(inside(directory, `${result.export_id}.json`), result, true);
    } else if (command === 'recover') {
      const dir = inside(s.config.output_root, first);
      await fs.access(path.join(dir, 'plan.json'));
      try { await fs.access(path.join(dir, 'run.json')); throw Error('RUN_ALREADY_SEALED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      // No invented end inventory, answer or termination guarantee; never restart the model.
      result = { schema_version: '1.0', recovery_id: id('recovery'), created_at: now(), run_id: first, status: 'INTERRUPTED', stop: 'STOP_UNCONFIRMED', model_called: false, saved_inventory: await inventory(dir), product_acceptance: 'NOT_REQUESTED' };
      await writeJson(inside(dir, `recoveries/${result.recovery_id}.json`), result, true);
      process.exitCode = 3;
    } else if (command === 'regrade') {
      const run = await regrade(s, first, values.reviews);
      result = compact(run); process.exitCode = run.exit_code;
    } else if (command === 'compare') {
      const right = await load(s, second);
      result = compareRecords(await load(s, first), right, values['assessment-policy'], assessmentSelection);
      await writeJson(inside(right.dir, `comparisons/${result.comparison_id}.json`), result, true);
      process.exitCode = result.results.some(r => r.after === 'DEV_FAIL') ? 2 : result.results.some(r => ['EXCLUDED', 'CONFOUNDED'].includes(r.category) || r.after !== 'DEV_PASS') ? 3 : 0;
    } else {
      const run = await load(s, first);
      result = command === 'review-template' ? await reviewTemplate(run, s.project) : compact(run);
      if (command === 'show') process.exitCode = exitCode(run.batch.assessments, run.record.unexecuted);
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', error: error.message, error_type: error.code ?? error.name }));
  process.exitCode = 4;
}
