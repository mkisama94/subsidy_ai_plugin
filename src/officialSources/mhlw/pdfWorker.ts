import { CatalogRepository } from '../../officialSubsidyCatalog/repository';
import { CatalogError, DAY, enabled, jobMessageSchema, sourceSchema, type CatalogEnv } from '../../officialSubsidyCatalog/types';
import { MhlwNetwork, type NetworkOptions } from './network';
import { enrichPdfAnalysis, extractPdf, PDF_EXTRACTOR_VERSION } from './pdf';

export async function processPdfJob(jobId:string,env:CatalogEnv,options:NetworkOptions={}) {
  if(!enabled(env.MHLW_INGESTION_ENABLED))return {status:'disabled'};
  if(!env.subsidy_ai_relations)throw new CatalogError('database_not_configured');
  const repo=new CatalogRepository(env.subsidy_ai_relations),job=await repo.job(jobId),now=options.now??Date.now;
  if(!job)return {status:'missing'};
  const source=await repo.source(job.source_id);
  if(!source||source.status!=='approved'||source.revision!==job.source_revision)return {status:'superseded'};
  if(job.next_refresh_at>now()&&['ready','needs_review','failed'].includes(job.status))return {status:'not_due'};
  const token=crypto.randomUUID();
  const claimed=await repo.db.prepare(`UPDATE discovery_document_jobs SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1
    WHERE id=? AND (status<>'processing' OR lease_until<=?) RETURNING id`).bind(token,now()+240_000,jobId,now()).first();
  if(!claimed)return {status:'busy'};
  try {
    const config=sourceSchema.parse(JSON.parse(source.config_json)),network=new MhlwNetwork(repo.db,config.policy,options);
    const previous=await repo.latestRecord(source.id,job.url),headers:Record<string,string>={Accept:'application/pdf'};
    if(previous&&job.fragments_json&&previous.extractor_version===PDF_EXTRACTOR_VERSION){if(previous.etag)headers['If-None-Match']=previous.etag;if(previous.last_modified)headers['If-Modified-Since']=previous.last_modified;}
    const response=await network.get(job.url,'files',headers);
    if(!await repo.db.prepare(`SELECT j.id FROM discovery_document_jobs j JOIN discovery_sources s ON s.id=j.source_id
      WHERE j.id=? AND j.lease_token=? AND j.lease_until>? AND s.revision=? AND s.status='approved'`)
      .bind(job.id,token,now(),source.revision).first())throw new CatalogError('superseded');
    let record=previous,analysis=job.fragments_json?JSON.parse(job.fragments_json):null;
    if(response.status===304) {
      if(!record||!analysis)throw new CatalogError('invalid_304');
      await repo.touch(record.id,now());
    } else {
      record=await repo.record(source.id,response,now(),PDF_EXTRACTOR_VERSION);
      // A changed body must never inherit fragments from the previous hash after a failed parse.
      await repo.db.prepare('UPDATE discovery_document_jobs SET record_id=?,fragments_json=NULL WHERE id=? AND lease_token=?').bind(record.id,jobId,token).run();
      analysis=await enrichPdfAnalysis(await extractPdf(response.bytes,{deadline:Date.now()+120_000}),env,now());
    }
    const state=analysis.warnings.length?'needs_review':'ready';
    const result=await repo.db.prepare(`UPDATE discovery_document_jobs SET status=?,record_id=?,fragments_json=?,next_refresh_at=?,
      lease_token=NULL,lease_until=NULL,last_error=NULL,attempts=0 WHERE id=? AND lease_token=? AND lease_until>?
      AND EXISTS(SELECT 1 FROM discovery_sources WHERE id=? AND revision=? AND status='approved')`)
      .bind(state,record!.id,JSON.stringify(analysis),now()+DAY,jobId,token,now(),source.id,source.revision).run();
    return {status:result.meta.changes===1?state:'superseded',pages:analysis.pageCount,fragments:analysis.fragments.length};
  } catch(error) {
    const safe=error instanceof CatalogError?error:new CatalogError('pdf_extraction_failed');
    if(['pdf_page_limit','pdf_item_limit','pdf_time_limit'].includes(safe.code)) {
      await repo.db.prepare(`UPDATE discovery_document_jobs SET status='needs_review',last_error=?,fragments_json=?,next_refresh_at=?,lease_token=NULL,lease_until=NULL
        WHERE id=? AND lease_token=?`).bind(safe.code,JSON.stringify({pageCount:null,fragments:[],warnings:[safe.code],extractorVersion:PDF_EXTRACTOR_VERSION}),now()+DAY,jobId,token).run();
      return {status:'needs_review',reasonCode:safe.code};
    }
    await repo.db.prepare(`UPDATE discovery_document_jobs SET status='failed',last_error=?,next_refresh_at=?,lease_token=NULL,lease_until=NULL
      WHERE id=? AND lease_token=?`).bind(safe.code,now()+Math.max(safe.retryAfterMs??0,job.attempts>=2?DAY:60_000*2**job.attempts),jobId,token).run();
    return {status:'failed',reasonCode:safe.code};
  }
}

export default {
  async queue(batch:MessageBatch<unknown>,env:CatalogEnv) {
    for(const message of batch.messages) {
      const parsed=jobMessageSchema.safeParse(message.body);
      if(!parsed.success){message.ack();continue;}
      try {
        const result=await processPdfJob(parsed.data.jobId,env);
        console.log(JSON.stringify({event:'mhlw_pdf',jobId:parsed.data.jobId,...result}));
        // Durable next_refresh_at drives bounded retries; do not amplify origin requests via queue redelivery.
        message.ack();
      }catch{message.retry({delaySeconds:300});}
    }
  },
  async fetch(){return Response.json({service:'subsidy-ai-mhlw-pdf',publicApi:false},{status:404});},
} satisfies ExportedHandler<CatalogEnv>;
