import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registrationSql, registrationFileSchema } from '../src/officialDocuments/registration.ts';
import { roundHash } from '../src/officialDocuments/types.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const file=path.resolve(root,flag('--file')??'config/official-document-sources.json');
const data=registrationFileSchema.parse(JSON.parse(await fs.readFile(file,'utf8')));
const sql=await registrationSql(data);
if(!data.sources.length)throw new Error('掲載元が未登録です。運営が確認した掲載元設定を --file で指定してください。');
if(!args.includes('--apply')) {
  console.log(JSON.stringify({mode:'validation_only',sourceCount:data.sources.length,sourceIds:data.sources.map(s=>s.id),sqlBytes:Buffer.byteLength(sql)},null,2));
} else {
  const local=args.includes('--local'),remote=args.includes('--remote');
  if(local===remote)throw new Error('--local または --remote のどちらかを明示してください。');
  const database=flag('--database');
  if(!database || !/^[A-Za-z0-9_-]+$/.test(database))throw new Error('--database に適用先を明示してください。');
  const dir=path.join(root,'.wrangler','document-import');await fs.mkdir(dir,{recursive:true});
  const output=path.join(dir,`${crypto.randomUUID()}.sql`);await fs.writeFile(output,sql);
  const wrangler=path.join(root,'node_modules','wrangler','bin','wrangler.js');
  const persist=flag('--persist-to');
  const execute=extra=>spawnSync(process.execPath,[wrangler,'d1','execute',database,local?'--local':'--remote',...(local&&persist?['--persist-to',persist]:[]),...extra],{
    cwd:root,encoding:'utf8',env:{...process.env,XDG_CONFIG_HOME:path.join(root,'.wrangler','xdg')}});
  try {
    const result=execute(['--file',output,'--yes']);
    if(result.status!==0)throw new Error(result.stderr||result.stdout||'D1 import failed');
    for(const source of data.sources) {
      const expectedBinding=await roundHash({id:0,program_series_key:source.program.seriesKey,canonical_name:source.program.name,
        fiscal_year:source.round.fiscalYear,round_name:source.round.name,scope_key:source.round.scopeKey,jgrants_subsidy_id:source.round.subsidyId,
        acceptance_start:source.round.acceptanceStart,acceptance_end:source.round.acceptanceEnd},source.round.workflowId);
      const result=execute(['--command',`SELECT id,registration_status,round_binding_hash,source_page_url,fetch_url,extractor_config_json,fetch_policy_json,updated_at FROM official_document_sources WHERE id='${source.id}'`,'--json']);
      if(result.status!==0)throw new Error('登録後の確認に失敗しました。');
      const json=JSON.parse(result.stdout);const rows=json.flatMap(x=>x.results??[]);
      if(rows.length!==1||rows[0].round_binding_hash!==expectedBinding||rows[0].registration_status!==source.registrationStatus||rows[0].source_page_url!==source.sourcePageUrl||rows[0].fetch_url!==source.fetchUrl||
        rows[0].extractor_config_json!==JSON.stringify(source.extractor)||rows[0].fetch_policy_json!==JSON.stringify(source.policy))throw new Error(`公募回との整合が取れず登録できませんでした: ${source.id}`);
    }
    console.log(JSON.stringify({mode:local?'local':'remote',database,registered:data.sources.length}));
  } finally {await fs.unlink(output);}
}
