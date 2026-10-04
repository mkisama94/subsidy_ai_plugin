import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const database=flag('--database'),local=args.includes('--local'),remote=args.includes('--remote');
if(!database||!/^[A-Za-z0-9_-]+$/.test(database)||local===remote)throw new Error('--database と --local または --remote を明示してください。');
const action=args[0]??'report',id=flag('--source-id');
const at=new Date().toISOString();
let query;
if(action==='report') query=`SELECT s.id,s.registration_status,s.last_attempt_status,s.last_error_code,s.last_success_at,s.next_refresh_at,s.failure_count,
 r.round_name,r.jgrants_subsidy_id,run.candidate_count,run.unclassified_count,run.warnings_json,run.ai_call_count
 FROM official_document_sources s JOIN subsidy_rounds r ON r.id=s.subsidy_round_id LEFT JOIN document_discovery_runs run ON run.id=s.active_run_id ORDER BY s.next_refresh_at`;
else {
 if(!id||!/^[0-9a-f-]{36}$/i.test(id)||!args.includes('--apply'))throw new Error('変更操作には --source-id と --apply が必要です。');
 if(action==='refresh')query=`UPDATE official_document_sources SET next_refresh_at='${at}' WHERE id='${id}' AND registration_status='approved'`;
 else if(['pause','revoke'].includes(action))query=`UPDATE official_document_sources SET registration_status='${action==='pause'?'paused':'revoked'}',approval_revision=approval_revision+1,lease_token=NULL,lease_until=NULL,updated_at='${at}' WHERE id='${id}'`;
 else if(action==='restore') {
  const run=flag('--run-id');if(!run||!/^[0-9a-f-]{36}$/i.test(run))throw new Error('--run-id が必要です。');
  query=`UPDATE official_document_sources SET active_run_id='${run}',last_success_at=(SELECT source_observed_at FROM document_discovery_runs WHERE id='${run}'),
   last_attempt_status='partial',last_error_code='operator_restored_snapshot',lease_token=NULL,lease_until=NULL,next_refresh_at='${at}',updated_at='${at}'
   WHERE id='${id}' AND registration_status='approved' AND EXISTS(SELECT 1 FROM document_discovery_runs WHERE id='${run}' AND source_id='${id}'
    AND approval_revision=official_document_sources.approval_revision AND round_binding_hash=official_document_sources.round_binding_hash AND status IN ('succeeded','not_modified'))`;
 } else throw new Error('report / refresh / pause / revoke / restore のいずれかを指定してください。');
}
if(action!=='report')query+=' RETURNING id,registration_status,next_refresh_at,active_run_id';
const persist=flag('--persist-to');
const r=spawnSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute',database,local?'--local':'--remote',
 ...(local&&persist?['--persist-to',persist]:[]),'--command',query,'--json'],{cwd:root,encoding:'utf8',env:{...process.env,XDG_CONFIG_HOME:path.join(root,'.wrangler/xdg')}});
if(r.status!==0)throw new Error(r.stderr||r.stdout||'D1 operation failed');
const result=JSON.parse(r.stdout);
if(action!=='report'&&!result.some(x=>x.results?.length===1))throw new Error('状態・承認版・公募回が一致せず変更されませんでした。');
console.log(JSON.stringify({action,target:local?'local':'remote',database,at,result},null,2));
