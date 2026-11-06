import { hostArgs, precheckHost, runHost, inspectEvents } from './process.mjs';

export const id = 'codex-cli';
export const version = '1.0';
export async function capabilities() {
  return { loading_modes: ['supplied_candidate_text'], features: ['text_answer', 'tool_events', 'process_stop'], isolation: 'UNCONFIRMED' };
}
export async function precheck(plan) {
  if (plan.capabilities.isolation === 'CONFIRMED') throw Error('UNSUPPORTED_ISOLATION_CLAIM');
  const result = await precheckHost(plan.config.host_bin);
  return { ...result, loading_mode: plan.config.loading_mode };
}
export async function execute({ config, workspace, schema, answer, prompt, directory, timeout }, signal) {
  const args = hostArgs({ workspace, model: config.model.requested_id, effort: config.model.reasoning_effort, schema, answer, suppliedText: true });
  const execution = await runHost({ binary: config.host_bin, args, workspace, prompt, directory, timeout, signal });
  return { ...execution, model_started: true, stop: execution.status === 'FINISHED' ? 'NOT_REQUESTED' : execution.stop_error ? 'STOP_UNCONFIRMED' : 'CONFIRMED' };
}
export async function inspect({ directory, forbiddenPaths }) {
  return inspectEvents(`${directory}/events.jsonl`, forbiddenPaths);
}
