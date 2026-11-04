1: import { CatalogRepository } from '../../officialSubsidyCatalog/repository';
2: import { CatalogError, DAY, enabled, jobMessageSchema, sourceSchema, type CatalogEnv } from '../../officialSubsidyCatalog/types';
3: import { MhlwNetwork, type NetworkOptions } from './network';
4: import { enrichPdfAnalysis, extractPdf, PDF_EXTRACTOR_VERSION } from './pdf';
5: 
6: export async function processPdfJob(jobId:string,env:CatalogEnv,options:NetworkOptions={}) {
7:   if(!enabled(env.MHLW_INGESTION_ENABLED))return {status:'disabled'};
8:   if(!env.subsidy_ai_relations)throw new CatalogError('database_not_configured');
9:   const repo=new CatalogRepository(env.subsidy_ai_relations),job=await repo.job(jobId),now=options.now??Date.now;
10:   if(!job)return {status:'missing'};
11:   const source=await repo.source(job.source_id);
12:   if(!source||source.status!=='approved'||source.revision!==job.source_revision)return {status:'superseded'};
13:   if(job.next_refresh_at>now()&&['ready','needs_review','failed'].includes(job.status))return {status:'not_due'};
14:   const token=crypto.randomUUID();
15:   const claimed=await repo.db.prepare(`UPDATE discovery_document_jobs SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1
16:     WHERE id=? AND (status<>'processing' OR lease_until<=?) RETURNING id`).bind(token,now()+240_000,jobId,now()).first();
17:   if(!claimed)return {status:'busy'};
18:   try {
19:     const config=sourceSchema.parse(JSON.parse(source.config_json)),network=new MhlwNetwork(repo.db,config.policy,options);
20:     const previous=await repo.latestRecord(source.id,job.url),headers:Record<string,string>={Accept:'application/pdf'};
21:     if(previous&&job.fragments_json&&previous.extractor_version===PDF_EXTRACTOR_VERSION){if(previous.etag)headers['If-None-Match']=previous.etag;if(previous.last_modified)headers['If-Modified-Since']=previous.last_modified;}
22:     const response=await network.get(job.url,'files',headers);
23:     if(!await repo.db.prepare(`SELECT j.id FROM discovery_document_jobs j JOIN discovery_sources s ON s.id=j.source_id
24:       WHERE j.id=? AND j.lease_token=? AND j.lease_until>? AND s.revision=? AND s.status='approved'`)
25:       .bind(job.id,token,now(),source.revision).first())throw new CatalogError('superseded');
26:     let record=previous,analysis=job.fragments_json?JSON.parse(job.fragments_json):null;
27:     if(response.status===304) {
28:       if(!record||!analysis)throw new CatalogError('invalid_304');
29:       await repo.touch(record.id,now());
30:     } else {
31:       record=await repo.record(source.id,response,now(),PDF_EXTRACTOR_VERSION);
32:       // A changed body must never inherit fragments from the previous hash after a failed parse.
33:       await repo.db.prepare('UPDATE discovery_document_jobs SET record_id=?,fragments_json=NULL WHERE id=? AND lease_token=?').bind(record.id,jobId,token).run();
34:       analysis=await enrichPdfAnalysis(await extractPdf(response.bytes,{deadline:Date.now()+120_000}),env,now());
35:     }
36:     const state=analysis.warnings.length?'needs_review':'ready';
37:     const result=await repo.db.prepare(`UPDATE discovery_document_jobs SET status=?,record_id=?,fragments_json=?,next_refresh_at=?,
38:       lease_token=NULL,lease_until=NULL,last_error=NULL,attempts=0 WHERE id=? AND lease_token=? AND lease_until>?
39:       AND EXISTS(SELECT 1 FROM discovery_sources WHERE id=? AND revision=? AND status='approved')`)
40:       .bind(state,record!.id,JSON.stringify(analysis),now()+DAY,jobId,token,now(),source.id,source.revision).run();
41:     return {status:result.meta.changes===1?state:'superseded',pages:analysis.pageCount,fragments:analysis.fragments.length};
42:   } catch(error) {
43:     const safe=error instanceof CatalogError?error:new CatalogError('pdf_extraction_failed');
44:     if(['pdf_page_limit','pdf_item_limit','pdf_time_limit'].includes(safe.code)) {
45:       await repo.db.prepare(`UPDATE discovery_document_jobs SET status='needs_review',last_error=?,fragments_json=?,next_refresh_at=?,lease_token=NULL,lease_until=NULL
46:         WHERE id=? AND lease_token=?`).bind(safe.code,JSON.stringify({pageCount:null,fragments:[],warnings:[safe.code],extractorVersion:PDF_EXTRACTOR_VERSION}),now()+DAY,jobId,token).run();
47:       return {status:'needs_review',reasonCode:safe.code};
48:     }
49:     await repo.db.prepare(`UPDATE discovery_document_jobs SET status='failed',last_error=?,next_refresh_at=?,lease_token=NULL,lease_until=NULL
50:       WHERE id=? AND lease_token=?`).bind(safe.code,now()+Math.max(safe.retryAfterMs??0,job.attempts>=2?DAY:60_000*2**job.attempts),jobId,token).run();
51:     return {status:'failed',reasonCode:safe.code};
52:   }
53: }
54: 
55: export default {
56:   async queue(batch:MessageBatch<unknown>,env:CatalogEnv) {
57:     for(const message of batch.messages) {
58:       const parsed=jobMessageSchema.safeParse(message.body);
59:       if(!parsed.success){message.ack();continue;}
60:       try {
61:         const result=await processPdfJob(parsed.data.jobId,env);
62:         console.log(JSON.stringify({event:'mhlw_pdf',jobId:parsed.data.jobId,...result}));
63:         // Durable next_refresh_at drives bounded retries; do not amplify origin requests via queue redelivery.
64:         message.ack();
65:       }catch{message.retry({delaySeconds:300});}
66:     }
67:   },
68:   async fetch(){return Response.json({service:'subsidy-ai-mhlw-pdf',publicApi:false},{status:404});},
69: } satisfies ExportedHandler<CatalogEnv>;