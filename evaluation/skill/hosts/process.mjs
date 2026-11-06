import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
const exec = promisify(execFile);

export function hostArgs({ workspace, model, effort, schema, answer, autoApproval = false, suppliedText = false }) {
  if (suppliedText && autoApproval) throw Error('SUPPLIED_TEXT_MUST_USE_READ_ONLY_WITHOUT_AUTO_APPROVAL');
  return ['exec', '--ephemeral', '--ignore-user-config', '--json', ...(autoApproval ? ['--approve-for-me'] : ['--sandbox', suppliedText ? 'read-only' : 'workspace-write', '-c', 'approval_policy="never"']),
    '--skip-git-repo-check', '--model', model,
    '-c', 'skills.include_instructions=false', '-c', 'skills.bundled.enabled=false',
    '-c', 'skills.config=[{name="subsidy-consultation",enabled=false},{name="company-research",enabled=false}]', '-c', 'plugins._default.enabled=false',
    '-c', 'mcp_servers={}', '-c', 'features.apps=false',
    '-c', 'features.multi_agent=false', '-c', 'web_search="disabled"',
    ...(effort ? ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : []),
    '-C', workspace, '--output-schema', schema, '--output-last-message', answer, '-'];
}

export async function precheckHost(binary) {
  const [version, help] = await Promise.all([
    exec(binary, ['--version'], { windowsHide: true, timeout: 10000 }),
    exec(binary, ['exec', '--help'], { windowsHide: true, timeout: 10000 })
  ]);
  for (const flag of ['--ephemeral', '--ignore-user-config', '--sandbox', '--output-schema', '--output-last-message', '--skip-git-repo-check']) {
    if (!help.stdout.includes(flag)) throw Error(`HOST_FLAG_UNSUPPORTED: ${flag}`);
  }
  const termination = await probeTreeTermination();
  return { binary, version: version.stdout.trim(), tool_set: 'host standard tools; user config ignored; skills/apps/multi_agent disabled by config',
    termination,
    loading_mode: 'explicit_candidate_path', supplied_hash: null, host_observed_hash: null,
    access_isolation: 'UNCONFIRMED', installed_skill_isolation: 'UNCONFIRMED_CONFIG_REQUESTED',
    notice: 'Managed host instructions and read access beyond workspace may remain. Not a candidate-only or Desktop-load attestation.' };
}

export async function probeTreeTermination() {
  // Only a disposable Node probe and its known child. No model or target code runs.
  const code = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log(JSON.stringify({child:c.pid})); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', code], { windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  let descendant;
  try {
    descendant = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('TERMINATION_PROBE_START_TIMEOUT')), 3000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.stdout.once('data', data => { clearTimeout(timer); try { resolve(JSON.parse(data.toString()).child); } catch (e) { reject(e); } });
    });
    await stopTree(child);
    // The known parent and descendant must both be gone, not only the wrapper.
    for (let n = 0; n < 20; n++) {
      const alive = [child.pid, descendant].filter(pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } });
      if (!alive.length) return { status: 'CONFIRMED_ON_PROBE', scope: 'disposable Node parent and child; actual host termination is recorded per run' };
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw Error('TREE_TERMINATION_UNCONFIRMED');
  } catch (e) {
    throw Error(`TREE_TERMINATION_UNAVAILABLE: ${e.message}`);
  } finally {
    // Cleanup is limited to the probe PIDs we just created, even on access denial.
    for (const pid of [descendant, child.pid]) if (Number.isInteger(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
}

async function stopTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(e => { if (child.exitCode === null) throw e; });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
}

export async function runHost({ binary, args, workspace, prompt, directory, timeout, signal }) {
  const child = spawn(binary, args, { cwd: workspace, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let reason = null, stopError = null, stopPromise = null, fallbackTimer;
  let forceFinish;
  const boundedStop = new Promise(resolve => { forceFinish = resolve; });
  const stop = why => {
    if (reason) return;
    reason = why;
    stopPromise = stopTree(child).catch(e => { stopError = e.message; child.kill(); });
    fallbackTimer = setTimeout(() => {
      stopError ??= 'HOST_CLOSE_UNCONFIRMED';
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); child.unref();
      forceFinish({ code: null, signal: null });
    }, 12000);
  };
  const timer = setTimeout(() => stop('TIMED_OUT'), timeout);
  const cancel = () => stop('CANCELLED');
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  try {
    const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, sig) => resolve({ code, signal: sig })); });
    const result = await Promise.race([Promise.all([exit,
      pipeline(child.stdout, createWriteStream(path.join(directory, 'events.jsonl'))),
      pipeline(child.stderr, createWriteStream(path.join(directory, 'stderr.log')))]).then(([result]) => result), boundedStop]);
    if (stopPromise) await stopPromise;
    return { status: reason ?? (result.code === 0 ? 'FINISHED' : 'HOST_ERROR'), ...result, stop_error: stopError };
  } catch (error) {
    stop('HOST_ERROR');
    if (stopPromise) await stopPromise;
    throw error;
  } finally { clearTimeout(timer); clearTimeout(fallbackTimer); signal?.removeEventListener('abort', cancel); }
}

export async function inspectEvents(file, forbiddenPaths) {
  let text = ''; try { text = await fs.readFile(file, 'utf8'); } catch {}
  const events = text.split(/\r?\n/).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const normalize = s => s.replaceAll('\\', '/').toLowerCase();
  // Inspect tool-call commands only, not the model's quoted explanations or self-report.
  const calls = events.filter(e => /command_execution|tool_call|mcp_tool_call/.test(e.item?.type ?? e.type ?? ''));
  const commands = calls.map(e => normalize(JSON.stringify(e.item?.command ?? e.item?.arguments ?? e.arguments ?? '')));
  return {
    events_complete: events.some(e => e.type === 'turn.completed') && text.trim().split(/\r?\n/).every(line => { try { JSON.parse(line); return true; } catch { return false; } }),
    observed_model: null, observed_effort: null, model_metadata_source: 'unknown',
    usage: events.filter(e => e.type === 'turn.completed').map(e => e.usage ?? null),
    contamination: commands.some(s => forbiddenPaths.some(p => s.includes(normalize(p)))) ? 'OBSERVED' : 'NOT_OBSERVED_NOT_PROOF',
    observed_tool_calls: calls.length
  };
}
