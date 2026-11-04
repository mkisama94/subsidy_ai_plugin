1: import { CatalogRepository } from '../../officialSubsidyCatalog/repository';
2: import { CatalogError, DAY, enabled, sourceSchema, type CatalogEnv, type SourceRow } from '../../officialSubsidyCatalog/types';
3: import { MhlwNetwork, type NetworkOptions } from './network';
4: import { extractMhlwHtml } from './extract';
5: import { collectDependencies } from './dependencies';
6: 
7: export async function collectMhlwSource(repo:CatalogRepository,source:SourceRow,options:NetworkOptions={}) {
8:   const now=options.now??Date.now,config=sourceSchema.parse(JSON.parse(source.config_json));
9:   const claim=await repo.claim(source,now());if(!claim)return {sourceId:source.id,status:'busy'};
10:   let count=0;
11:   try {
12:     const network=new MhlwNetwork(repo.db,config.policy,options),previous=await repo.latestRecord(source.id,config.url);
13:     const dependencies=await collectDependencies(repo,source,config,network,now,claim.token);
14:     const headers:Record<string,string>={Accept:'text/html'};
15:     // A changed extractor/config must obtain the body again, even when the origin is unchanged.
16:     const previousRun=await repo.db.prepare(`SELECT id FROM discovery_fetch_runs WHERE source_id=? AND source_revision=? AND status='succeeded' LIMIT 1`).bind(source.id,source.revision).first();
17:     if(previous&&previousRun&&!dependencies.changed){if(previous.etag)headers['If-None-Match']=previous.etag;if(previous.last_modified)headers['If-Modified-Since']=previous.last_modified;}
18:     const response=await network.get(config.url,'pages',headers);
19:     if(!await repo.owns(source,claim.token,now()))throw new CatalogError('superseded');
20:     if(response.status===304) {
21:       if(!previous)throw new CatalogError('invalid_304');
22:       await repo.touch(previous.id,now());
23:       await repo.finish(source,claim,now(),0,undefined,undefined,true);
24:       return {sourceId:source.id,status:'not_modified'};
25:     }
26:     const record=await repo.record(source.id,response,now());
27:     const result=extractMhlwHtml(new TextDecoder().decode(response.bytes),config,record);
28:     // Never replace a complete source with silently missing registered courses.
29:     if(result.candidates.length!==config.courses.length)throw new CatalogError('course_coverage_dropped');
30:     for(const candidate of result.candidates){
31:       candidate.evidence.push(...dependencies.evidence);
32:       candidate.documents=[...candidate.documents,...dependencies.documents.map(d=>({...d,sourcePageUrl:config.url,association:'common' as const}))].slice(0,100);
33:       await repo.stage(source,claim.runId,claim.token,candidate,now());count++;
34:     }
35:     await repo.enqueueDocuments(source,[...result.documents,...dependencies.documents],now());
36:     await repo.finish(source,claim,now(),count);
37:     return {sourceId:source.id,status:'staged',count,coverage:result.coverage};
38:   } catch(error) {
39:     const safe=error instanceof CatalogError?error:new CatalogError('collection_failed');
40:     await repo.finish(source,claim,now(),count,safe.code,safe.retryAfterMs);
41:     return {sourceId:source.id,status:'failed',reasonCode:safe.code};
42:   }
43: }
44: 
45: export async function queueDuePdfs(repo:CatalogRepository,queue:CatalogEnv['MHLW_PDF_QUEUE'],now:number) {
46:   if(!queue)return {status:'queue_not_configured',queued:0};
47:   let count=0;
48:   for(const job of await repo.jobs()) {
49:     if(count>=5)break;
50:     const source=await repo.source(job.source_id);
51:     if(!source||source.status!=='approved'||source.revision!==job.source_revision||job.next_refresh_at>now)continue;
52:     const token=crypto.randomUUID();
53:     const r=await repo.db.prepare(`UPDATE discovery_document_jobs SET status='queued',lease_token=?,lease_until=?,next_refresh_at=?
54:       WHERE id=? AND (lease_until IS NULL OR lease_until<=?) RETURNING id`).bind(token,now+10*60_000,now+10*60_000,job.id,now).first();
55:     if(!r)continue;
56:     try{await queue.send({jobId:job.id});count++;}
57:     catch{await repo.db.prepare(`UPDATE discovery_document_jobs SET status='pending',lease_token=NULL,lease_until=NULL,next_refresh_at=? WHERE id=? AND lease_token=?`).bind(now+60_000,job.id,token).run();}
58:   }
59:   return {status:'finished',queued:count};
60: }
61: 
62: export async function collectDueMhlwSources(env:CatalogEnv) {
63:   if(!enabled(env.MHLW_INGESTION_ENABLED))return {status:'disabled',results:[]};
64:   if(!env.subsidy_ai_relations)return {status:'unavailable',reasonCode:'database_not_configured',results:[]};
65:   try {
66:     const repo=new CatalogRepository(env.subsidy_ai_relations),deadline=Date.now()+180_000,results=[];
67:     for(const source of (await repo.sources()).filter(s=>s.status==='approved'&&s.next_refresh_at<=Date.now()).slice(0,3)) {
68:       if(Date.now()>deadline-20_000)break;
69:       results.push(await collectMhlwSource(repo,source,{deadline}));
70:     }
71:     // Independent of HTML 304: attachments are rechecked on their own schedule.
72:     const pdf=await queueDuePdfs(repo,env.MHLW_PDF_QUEUE,Date.now());
73:     await repo.cleanup(Date.now());
74:     return {status:'finished',results,pdf};
75:   }catch{return {status:'unavailable',reasonCode:'catalog_database_unavailable',results:[]};}
76: }