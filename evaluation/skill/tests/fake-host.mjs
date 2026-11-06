import fs from 'node:fs/promises';
import path from 'node:path';
export const id = 'fake';
export const version = '1';
export async function capabilities() { return { loading_modes: ['supplied_candidate_text'], features: ['text_answer', 'tool_events', 'process_stop'], isolation: 'UNCONFIRMED' }; }
export async function precheck() { return { test_only: true, version: 'fixture-1' }; }
export async function execute(input) {
  await fs.writeFile(input.answer, JSON.stringify({ response: '固定回答。意味は人が確認する。', sources: [], actions: [] }));
  return { status: 'FINISHED', code: 0, model_started: false, stop: 'NOT_REQUESTED' };
}
export async function inspect() { return { events_complete: true, observed_model: null, observed_effort: null, contamination: 'NOT_OBSERVED_NOT_PROOF', observed_tool_calls: 0, usage: [] }; }
