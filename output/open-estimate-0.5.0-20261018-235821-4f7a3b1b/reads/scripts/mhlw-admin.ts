1: import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
2: import { resolve } from 'node:path';
3: import { getPlatformProxy } from 'wrangler';
4: import { CatalogRepository } from '../src/officialSubsidyCatalog/repository';
5: import { sourceFileSchema, payloadSchema, type CatalogEnv } from '../src/officialSubsidyCatalog/types';
6: import { permittedUrl } from '../src/officialDocuments/sourcePolicy';
7: import { collectMhlwSource, queueDuePdfs } from '../src/officialSources/mhlw/collect';
8: import { processPdfJob } from '../src/officialSources/mhlw/pdfWorker';
9: import { discoverSubsidies, getDiscoveredSubsidyDetail } from '../src/subsidyDiscovery/service';
10: 
11: const args=process.argv.slice(2),action=args[0],flag=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
12: const remote=args.includes('--remote'),local=args.includes('--local');
13: if(remote===local)throw new Error('--local または --remote を明示してください。');
14: if(!['register','report','refresh','pause','resume','collect','pdf','validate','publish','rollback','review-template','search','detail'].includes(action))throw new Error('操作を指定してください。');
15: const root=resolve(import.meta.dirname,'..');
16: await mkdir(resolve(root,'.wrangler'),{recursive:true});
17: const proxyPath=resolve(root,`.wrangler/mhlw-admin-${crypto.randomUUID()}.json`);
18: await writeFile(proxyPath,JSON.stringify({name:'subsidy-ai-mhlw-admin',compatibility_date:'2026-08-30',compatibility_flags:['nodejs_compat'],
19:   d1_databases:[{binding:'subsidy_ai_relations',database_name:'subsidy-ai-relations',database_id:'7a921696-7f84-4195-b629-61ff7c2bf611',remote}]}));
20: const proxy=await getPlatformProxy<CatalogEnv>({configPath:proxyPath,envFiles:[],remoteBindings:remote,persist:{path:resolve(root,flag('--persist-to')??'.wrangler/state/v3')}});
21: try {
22:   const repo=new CatalogRepository(proxy.env.subsidy_ai_relations!),now=Date.now();let result:unknown;
23:   const required=(name:string)=>{const s=flag(name);if(!s)throw new Error(`${name} が必要です。`);return s;};
24:   const file=async()=>JSON.parse(await readFile(resolve(root,required('--file')),'utf8'));
25:   if(action==='register') {
26:     const config=sourceFileSchema.parse(await file());
27:     for(const s of config.sources) {
28:       if(new URL(s.url).hostname!=='www.mhlw.go.jp'||new URL(s.termsUrl).hostname!=='www.mhlw.go.jp')throw new Error('初期登録対象は厚生労働省公式サイトです。');
29:       permittedUrl(s.url,s.policy,'pages');await repo.register(s,now);
30:     }
31:     result={registered:config.sources.length};
32:   } else if(action==='report') {
33:     result={activeRelease:await repo.activeId(),sources:(await repo.sources()).map(s=>({id:s.id,status:s.status,revision:s.revision,lastSuccessAt:s.last_success_at,lastError:s.last_error,failures:s.failures,
34:       courses:JSON.parse(s.config_json).courses.map((c:{name:string})=>c.name)})),
35:       versions:(await repo.db.prepare(`SELECT id,candidate_id,source_revision,review_status,created_at FROM discovery_candidate_versions ORDER BY created_at DESC`).all()).results,
36:       metrics:{jobStates:(await repo.db.prepare('SELECT status,COUNT(*) count FROM discovery_document_jobs GROUP BY status').all()).results,
37:         dailyRequests:(await repo.db.prepare('SELECT hostname,day,requests,next_at FROM discovery_host_budget').all()).results,
38:         aiCalls:(await repo.db.prepare('SELECT day,calls FROM discovery_ai_budget ORDER BY day DESC LIMIT 7').all()).results,
39:         staleRecords:(await repo.db.prepare('SELECT COUNT(*) count FROM discovery_source_records WHERE last_verified_at<?').bind(now-2*86400000).first()),
40:         continuingFailures:(await repo.sources()).filter(s=>s.failures>=3).map(s=>({sourceId:s.id,error:s.last_error,failures:s.failures}))},
41:       jobs:(await repo.jobs()).map(j=>({id:j.id,sourceId:j.source_id,url:j.url,title:j.title,status:j.status,lastError:j.last_error,recordId:j.record_id}))};
42:   } else if(['refresh','pause','resume'].includes(action)) {
43:     await repo.control(required('--source-id'),action as 'refresh'|'pause'|'resume',now);result={action,status:'updated'};
44:   } else if(action==='collect') {
45:     const sources=(await repo.sources()).filter(s=>s.status==='approved'&&(!flag('--source-id')||s.id===flag('--source-id')));
46:     const results=[];for(const s of sources)results.push(await collectMhlwSource(repo,s));result={results,pdf:await queueDuePdfs(repo,proxy.env.MHLW_PDF_QUEUE,Date.now())};
47:   } else if(action==='pdf') {
48:     result=await processPdfJob(required('--job-id'),{...proxy.env,MHLW_INGESTION_ENABLED:'true'});
49:   } else if(action==='review-template') {
50:     const v=await repo.version(required('--version-id'));if(!v)throw new Error('版がありません。');
51:     result={versionId:v.id,note:'公式資料と照合した内容を記入してください。',payload:payloadSchema.parse(JSON.parse(v.payload_json)),
52:       availableDocumentEvidence:(await repo.jobs()).filter(j=>j.source_id===JSON.parse(v.payload_json).sourceId&&j.record_id).map(j=>({recordId:j.record_id,url:j.url,title:j.title,analysis:JSON.parse(j.fragments_json??'null')}))};
53:   } else if(action==='validate') {
54:     if(flag('--file')){const input=await file();result=await repo.reviewPayload(input.versionId,input.payload,input.note,now);}
55:     else result=await repo.validate(required('--version-id'),required('--note'),now);
56:   } else if(action==='publish') {
57:     const input=await file();if(!Object.hasOwn(input,'expectedReleaseId'))throw new Error('expectedReleaseId が必要です。初回はnull。');
58:     result=await repo.publish(input.versionIds,input.expectedReleaseId,input.note,now);
59:   } else if(action==='rollback') {
60:     const expected=required('--expected-release');await repo.rollback(required('--release-id'),expected==='none'?null:expected);result={status:'restored'};
61:   } else if(action==='search') {
62:     result=await discoverSubsidies({query:required('--query'),sources:['mhlw']},{...proxy.env,MHLW_CATALOG_SERVING_ENABLED:'true'});
63:   } else if(action==='detail') {
64:     result=await getDiscoveredSubsidyDetail({candidate_id:required('--candidate-id'),version_id:required('--version-id')},{...proxy.env,MHLW_CATALOG_SERVING_ENABLED:'true'});
65:   }
66:   const output=JSON.stringify({action,target:remote?'remote':'local',...((result??{}) as object)},null,2);
67:   if(flag('--output'))await writeFile(resolve(root,required('--output')),output+'\n');else console.log(output);
68: } finally {await proxy.dispose();await unlink(proxyPath);}