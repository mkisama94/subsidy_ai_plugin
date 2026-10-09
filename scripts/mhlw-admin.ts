import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { CatalogRepository } from '../src/officialSubsidyCatalog/repository';
import { sourceFileSchema, payloadSchema, type CatalogEnv } from '../src/officialSubsidyCatalog/types';
import { permittedUrl } from '../src/officialDocuments/sourcePolicy';
import { collectMhlwSource, queueDuePdfs } from '../src/officialSources/mhlw/collect';
import { processPdfJob } from '../src/officialSources/mhlw/pdfWorker';
import { discoverSubsidies, getDiscoveredSubsidyDetail } from '../src/subsidyDiscovery/service';

const args=process.argv.slice(2),action=args[0],flag=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const remote=args.includes('--remote'),local=args.includes('--local');
if(remote===local)throw new Error('--local または --remote を明示してください。');
if(!['register','report','refresh','pause','resume','collect','pdf','validate','publish','rollback','review-template','search','detail'].includes(action))throw new Error('操作を指定してください。');
const root=resolve(import.meta.dirname,'..');
await mkdir(resolve(root,'.wrangler'),{recursive:true});
const proxyPath=resolve(root,`.wrangler/mhlw-admin-${crypto.randomUUID()}.json`);
await writeFile(proxyPath,JSON.stringify({name:'subsidy-ai-mhlw-admin',compatibility_date:'2026-08-30',compatibility_flags:['nodejs_compat'],
  d1_databases:[{binding:'subsidy_ai_relations',database_name:'subsidy-ai-relations',database_id:'7a921696-7f84-4195-b629-61ff7c2bf611',remote}]}));
const proxy=await getPlatformProxy<CatalogEnv>({configPath:proxyPath,envFiles:[],remoteBindings:remote,persist:{path:resolve(root,flag('--persist-to')??'.wrangler/state/v3')}});
try {
  const repo=new CatalogRepository(proxy.env.subsidy_ai_relations!),now=Date.now();let result:unknown;
  const required=(name:string)=>{const s=flag(name);if(!s)throw new Error(`${name} が必要です。`);return s;};
  const file=async()=>JSON.parse(await readFile(resolve(root,required('--file')),'utf8'));
  if(action==='register') {
    const config=sourceFileSchema.parse(await file());
    for(const s of config.sources) {
      if(new URL(s.url).hostname!=='www.mhlw.go.jp'||new URL(s.termsUrl).hostname!=='www.mhlw.go.jp')throw new Error('初期登録対象は厚生労働省公式サイトです。');
      permittedUrl(s.url,s.policy,'pages');await repo.register(s,now);
    }
    result={registered:config.sources.length};
  } else if(action==='report') {
    result={activeRelease:await repo.activeId(),sources:(await repo.sources()).map(s=>({id:s.id,status:s.status,revision:s.revision,lastSuccessAt:s.last_success_at,lastError:s.last_error,failures:s.failures,
      courses:JSON.parse(s.config_json).courses.map((c:{name:string})=>c.name)})),
      versions:(await repo.db.prepare(`SELECT id,candidate_id,source_revision,review_status,created_at FROM discovery_candidate_versions ORDER BY created_at DESC`).all()).results,
      metrics:{jobStates:(await repo.db.prepare('SELECT status,COUNT(*) count FROM discovery_document_jobs GROUP BY status').all()).results,
        dailyRequests:(await repo.db.prepare('SELECT hostname,day,requests,next_at FROM discovery_host_budget').all()).results,
        aiCalls:(await repo.db.prepare('SELECT day,calls FROM discovery_ai_budget ORDER BY day DESC LIMIT 7').all()).results,
        staleRecords:(await repo.db.prepare('SELECT COUNT(*) count FROM discovery_source_records WHERE last_verified_at<?').bind(now-2*86400000).first()),
        continuingFailures:(await repo.sources()).filter(s=>s.failures>=3).map(s=>({sourceId:s.id,error:s.last_error,failures:s.failures}))},
      jobs:(await repo.jobs()).map(j=>({id:j.id,sourceId:j.source_id,url:j.url,title:j.title,status:j.status,lastError:j.last_error,recordId:j.record_id}))};
  } else if(['refresh','pause','resume'].includes(action)) {
    await repo.control(required('--source-id'),action as 'refresh'|'pause'|'resume',now);result={action,status:'updated'};
  } else if(action==='collect') {
    const sources=(await repo.sources()).filter(s=>s.status==='approved'&&(!flag('--source-id')||s.id===flag('--source-id')));
    const results=[];for(const s of sources)results.push(await collectMhlwSource(repo,s));result={results,pdf:await queueDuePdfs(repo,proxy.env.MHLW_PDF_QUEUE,Date.now())};
  } else if(action==='pdf') {
    result=await processPdfJob(required('--job-id'),{...proxy.env,MHLW_INGESTION_ENABLED:'true'});
  } else if(action==='review-template') {
    const v=await repo.version(required('--version-id'));if(!v)throw new Error('版がありません。');
    result={versionId:v.id,note:'公式資料と照合した内容を記入してください。',payload:payloadSchema.parse(JSON.parse(v.payload_json)),
      availableDocumentEvidence:(await repo.jobs()).filter(j=>j.source_id===JSON.parse(v.payload_json).sourceId&&j.record_id).map(j=>({recordId:j.record_id,url:j.url,title:j.title,analysis:JSON.parse(j.fragments_json??'null')}))};
  } else if(action==='validate') {
    if(flag('--file')){const input=await file();result=await repo.reviewPayload(input.versionId,input.payload,input.note,now);}
    else result=await repo.validate(required('--version-id'),required('--note'),now);
  } else if(action==='publish') {
    const input=await file();if(!Object.hasOwn(input,'expectedReleaseId'))throw new Error('expectedReleaseId が必要です。初回はnull。');
    result=await repo.publish(input.versionIds,input.expectedReleaseId,input.note,now);
  } else if(action==='rollback') {
    const expected=required('--expected-release');await repo.rollback(required('--release-id'),expected==='none'?null:expected);result={status:'restored'};
  } else if(action==='search') {
    result=await discoverSubsidies({query:required('--query'),sources:['mhlw']},{...proxy.env,MHLW_CATALOG_SERVING_ENABLED:'true'});
  } else if(action==='detail') {
    result=await getDiscoveredSubsidyDetail({candidate_id:required('--candidate-id'),version_id:required('--version-id')},{...proxy.env,MHLW_CATALOG_SERVING_ENABLED:'true'});
  }
  const output=JSON.stringify({action,target:remote?'remote':'local',...((result??{}) as object)},null,2);
  if(flag('--output'))await writeFile(resolve(root,required('--output')),output+'\n');else console.log(output);
} finally {await proxy.dispose();await unlink(proxyPath);}
