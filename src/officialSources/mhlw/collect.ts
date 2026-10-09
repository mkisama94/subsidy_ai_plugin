import { CatalogRepository } from '../../officialSubsidyCatalog/repository';
import { CatalogError, DAY, enabled, sourceSchema, type CatalogEnv, type SourceRow } from '../../officialSubsidyCatalog/types';
import { MhlwNetwork, type NetworkOptions } from './network';
import { extractMhlwHtml } from './extract';
import { collectDependencies } from './dependencies';

export async function collectMhlwSource(repo:CatalogRepository,source:SourceRow,options:NetworkOptions={}) {
  const now=options.now??Date.now,config=sourceSchema.parse(JSON.parse(source.config_json));
  const claim=await repo.claim(source,now());if(!claim)return {sourceId:source.id,status:'busy'};
  let count=0;
  try {
    const network=new MhlwNetwork(repo.db,config.policy,options),previous=await repo.latestRecord(source.id,config.url);
    const dependencies=await collectDependencies(repo,source,config,network,now,claim.token);
    const headers:Record<string,string>={Accept:'text/html'};
    // A changed extractor/config must obtain the body again, even when the origin is unchanged.
    const previousRun=await repo.db.prepare(`SELECT id FROM discovery_fetch_runs WHERE source_id=? AND source_revision=? AND status='succeeded' LIMIT 1`).bind(source.id,source.revision).first();
    if(previous&&previousRun&&!dependencies.changed){if(previous.etag)headers['If-None-Match']=previous.etag;if(previous.last_modified)headers['If-Modified-Since']=previous.last_modified;}
    const response=await network.get(config.url,'pages',headers);
    if(!await repo.owns(source,claim.token,now()))throw new CatalogError('superseded');
    if(response.status===304) {
      if(!previous)throw new CatalogError('invalid_304');
      await repo.touch(previous.id,now());
      await repo.finish(source,claim,now(),0,undefined,undefined,true);
      return {sourceId:source.id,status:'not_modified'};
    }
    const record=await repo.record(source.id,response,now());
    const result=extractMhlwHtml(new TextDecoder().decode(response.bytes),config,record);
    // Never replace a complete source with silently missing registered courses.
    if(result.candidates.length!==config.courses.length)throw new CatalogError('course_coverage_dropped');
    for(const candidate of result.candidates){
      candidate.evidence.push(...dependencies.evidence);
      candidate.documents=[...candidate.documents,...dependencies.documents.map(d=>({...d,sourcePageUrl:config.url,association:'common' as const}))].slice(0,100);
      await repo.stage(source,claim.runId,claim.token,candidate,now());count++;
    }
    await repo.enqueueDocuments(source,[...result.documents,...dependencies.documents],now());
    await repo.finish(source,claim,now(),count);
    return {sourceId:source.id,status:'staged',count,coverage:result.coverage};
  } catch(error) {
    const safe=error instanceof CatalogError?error:new CatalogError('collection_failed');
    await repo.finish(source,claim,now(),count,safe.code,safe.retryAfterMs);
    return {sourceId:source.id,status:'failed',reasonCode:safe.code};
  }
}

export async function queueDuePdfs(repo:CatalogRepository,queue:CatalogEnv['MHLW_PDF_QUEUE'],now:number) {
  if(!queue)return {status:'queue_not_configured',queued:0};
  let count=0;
  for(const job of await repo.jobs()) {
    if(count>=5)break;
    const source=await repo.source(job.source_id);
    if(!source||source.status!=='approved'||source.revision!==job.source_revision||job.next_refresh_at>now)continue;
    const token=crypto.randomUUID();
    const r=await repo.db.prepare(`UPDATE discovery_document_jobs SET status='queued',lease_token=?,lease_until=?,next_refresh_at=?
      WHERE id=? AND (lease_until IS NULL OR lease_until<=?) RETURNING id`).bind(token,now+10*60_000,now+10*60_000,job.id,now).first();
    if(!r)continue;
    try{await queue.send({jobId:job.id});count++;}
    catch{await repo.db.prepare(`UPDATE discovery_document_jobs SET status='pending',lease_token=NULL,lease_until=NULL,next_refresh_at=? WHERE id=? AND lease_token=?`).bind(now+60_000,job.id,token).run();}
  }
  return {status:'finished',queued:count};
}

export async function collectDueMhlwSources(env:CatalogEnv) {
  if(!enabled(env.MHLW_INGESTION_ENABLED))return {status:'disabled',results:[]};
  if(!env.subsidy_ai_relations)return {status:'unavailable',reasonCode:'database_not_configured',results:[]};
  try {
    const repo=new CatalogRepository(env.subsidy_ai_relations),deadline=Date.now()+180_000,results=[];
    for(const source of (await repo.sources()).filter(s=>s.status==='approved'&&s.next_refresh_at<=Date.now()).slice(0,3)) {
      if(Date.now()>deadline-20_000)break;
      results.push(await collectMhlwSource(repo,source,{deadline}));
    }
    // Independent of HTML 304: attachments are rechecked on their own schedule.
    const pdf=await queueDuePdfs(repo,env.MHLW_PDF_QUEUE,Date.now());
    await repo.cleanup(Date.now());
    return {status:'finished',results,pdf};
  }catch{return {status:'unavailable',reasonCode:'catalog_database_unavailable',results:[]};}
}
