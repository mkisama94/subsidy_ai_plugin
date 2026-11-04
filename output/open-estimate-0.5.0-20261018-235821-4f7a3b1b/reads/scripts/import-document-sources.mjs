1: import fs from 'node:fs/promises';
2: import path from 'node:path';
3: import { spawnSync } from 'node:child_process';
4: import { fileURLToPath } from 'node:url';
5: import { registrationSql, registrationFileSchema } from '../src/officialDocuments/registration.ts';
6: import { roundHash } from '../src/officialDocuments/types.ts';
7: 
8: const root=fileURLToPath(new URL('..',import.meta.url));
9: const args=process.argv.slice(2);
10: const flag=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
11: const file=path.resolve(root,flag('--file')??'config/official-document-sources.json');
12: const data=registrationFileSchema.parse(JSON.parse(await fs.readFile(file,'utf8')));
13: const sql=await registrationSql(data);
14: if(!data.sources.length)throw new Error('掲載元が未登録です。運営が確認した掲載元設定を --file で指定してください。');
15: if(!args.includes('--apply')) {
16:   console.log(JSON.stringify({mode:'validation_only',sourceCount:data.sources.length,sourceIds:data.sources.map(s=>s.id),sqlBytes:Buffer.byteLength(sql)},null,2));
17: } else {
18:   const local=args.includes('--local'),remote=args.includes('--remote');
19:   if(local===remote)throw new Error('--local または --remote のどちらかを明示してください。');
20:   const database=flag('--database');
21:   if(!database || !/^[A-Za-z0-9_-]+$/.test(database))throw new Error('--database に適用先を明示してください。');
22:   const dir=path.join(root,'.wrangler','document-import');await fs.mkdir(dir,{recursive:true});
23:   const output=path.join(dir,`${crypto.randomUUID()}.sql`);await fs.writeFile(output,sql);
24:   const wrangler=path.join(root,'node_modules','wrangler','bin','wrangler.js');
25:   const persist=flag('--persist-to');
26:   const execute=extra=>spawnSync(process.execPath,[wrangler,'d1','execute',database,local?'--local':'--remote',...(local&&persist?['--persist-to',persist]:[]),...extra],{
27:     cwd:root,encoding:'utf8',env:{...process.env,XDG_CONFIG_HOME:path.join(root,'.wrangler','xdg')}});
28:   try {
29:     const result=execute(['--file',output,'--yes']);
30:     if(result.status!==0)throw new Error(result.stderr||result.stdout||'D1 import failed');
31:     for(const source of data.sources) {
32:       const expectedBinding=await roundHash({id:0,program_series_key:source.program.seriesKey,canonical_name:source.program.name,
33:         fiscal_year:source.round.fiscalYear,round_name:source.round.name,scope_key:source.round.scopeKey,jgrants_subsidy_id:source.round.subsidyId,
34:         acceptance_start:source.round.acceptanceStart,acceptance_end:source.round.acceptanceEnd},source.round.workflowId);
35:       const result=execute(['--command',`SELECT id,registration_status,round_binding_hash,source_page_url,fetch_url,extractor_config_json,fetch_policy_json,updated_at FROM official_document_sources WHERE id='${source.id}'`,'--json']);
36:       if(result.status!==0)throw new Error('登録後の確認に失敗しました。');
37:       const json=JSON.parse(result.stdout);const rows=json.flatMap(x=>x.results??[]);
38:       if(rows.length!==1||rows[0].round_binding_hash!==expectedBinding||rows[0].registration_status!==source.registrationStatus||rows[0].source_page_url!==source.sourcePageUrl||rows[0].fetch_url!==source.fetchUrl||
39:         rows[0].extractor_config_json!==JSON.stringify(source.extractor)||rows[0].fetch_policy_json!==JSON.stringify(source.policy))throw new Error(`公募回との整合が取れず登録できませんでした: ${source.id}`);
40:     }
41:     console.log(JSON.stringify({mode:local?'local':'remote',database,registered:data.sources.length}));
42:   } finally {await fs.unlink(output);}
43: }