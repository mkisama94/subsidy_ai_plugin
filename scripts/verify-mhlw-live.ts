// Official GET requests + ephemeral SQLite only. Never changes remote D1 or publishes a service.
import { readFile, writeFile } from 'node:fs/promises';
import { catalogDatabase } from '../test/helpers/catalogDatabase';
import { CatalogRepository } from '../src/officialSubsidyCatalog/repository';
import { sourceFileSchema, type CandidatePayload } from '../src/officialSubsidyCatalog/types';
import { collectMhlwSource } from '../src/officialSources/mhlw/collect';
import { processPdfJob } from '../src/officialSources/mhlw/pdfWorker';
import { discoverSubsidies, getDiscoveredSubsidyDetail } from '../src/subsidyDiscovery/service';

const seeds=sourceFileSchema.parse(JSON.parse(await readFile(new URL('../config/mhlw-sources.json',import.meta.url),'utf8')));
const db=catalogDatabase(),repo=new CatalogRepository(db.db),startedAt=new Date().toISOString();
const report:any={startedAt,environment:'Node + ephemeral SQLite; official live GET; not Cloudflare production',collections:[],searches:[],pdf:[]};
try {
  for(const config of seeds.sources){await repo.register(config,Date.now());const r=await collectMhlwSource(repo,(await repo.source(config.id))!);report.collections.push(r);console.log(JSON.stringify(r));}
  const versions=(await repo.db.prepare('SELECT * FROM discovery_candidate_versions ORDER BY candidate_id').all<any>()).results;
  for(const v of versions)await repo.validate(v.id,'自動照合：実取得HTMLの登録コース名と根拠位置。金額・適用時期は未確認。',Date.now());
  if(versions.length!==17)throw new Error(`Expected 17 overview courses, got ${versions.length}`);
  report.release=await repo.publish(versions.map(v=>v.id),null,'実地検証専用の一時DB。概要のみの自動検証版。外部提供なし。',Date.now());
  const env={subsidy_ai_relations:db.db,MHLW_CATALOG_SERVING_ENABLED:'true'};
  const queries=['AI研修','正社員化','採用',...seeds.sources.flatMap(s=>s.courses.map(c=>c.name))];
  const timings:number[]=[];
  for(const query of queries){const start=performance.now();const r=await discoverSubsidies({query,sources:['mhlw'],limit:50},env);timings.push(performance.now()-start);
    const results=[...r.candidates,...r.uncertainCandidates];if(!results.length)throw new Error(`No match: ${query}`);
    report.searches.push({query,courses:results.map(c=>c.courseName)});
    const named=versions.map(v=>JSON.parse(v.payload_json) as CandidatePayload).find(p=>p.courseName===query);
    if(named&&results[0].candidateId!==named.candidateId)throw new Error(`Official name not ranked first: ${query}`);
  }
  report.latency={samples:timings.length,p95Ms:[...timings].sort((a,b)=>a-b)[Math.ceil(timings.length*.95)-1],scope:'local in-process D1 adapter, not production SLO'};
  report.details=[];
  for(const v of versions){const detail=await getDiscoveredSubsidyDetail({candidate_id:v.candidate_id,version_id:v.id},env);if(detail.status!=='overview_only')throw new Error(`Bad detail ${detail.status}`);
    report.details.push({candidateId:v.candidate_id,status:detail.status,evidenceRecords:(detail.data?.sourceRecords as any[])?.length});}
  const jobs=await repo.jobs();report.documents={queued:jobs.length,sample:jobs.slice(0,5).map(j=>({id:j.id,title:j.title,url:j.url}))};
  // Opt-in bounded real PDF parsing: pick a short notice and the official complete guidelines.
  if(process.argv.includes('--pdf')){
    const small=jobs.find(j=>/リーフレット/.test(j.title))??jobs[0];
    const large=jobs.find(j=>/全体|全編|19[.,]3/.test(j.title));
    for(const job of [small,large].filter((j,i,a)=>j&&a.findIndex(x=>x?.url===j.url)===i)){
      const t=performance.now(),r=await processPdfJob(job!.id,{subsidy_ai_relations:db.db,MHLW_INGESTION_ENABLED:'true'});
      const stored=await repo.job(job!.id),record=stored?.record_id?await repo.latestRecord(job!.source_id,job!.url):null;
      report.pdf.push({url:job!.url,title:job!.title,...r,elapsedMs:performance.now()-t,byteLength:record?.byte_length,contentHash:record?.content_hash,
        warnings:stored?.fragments_json?JSON.parse(stored.fragments_json).warnings:[]});console.log(JSON.stringify(report.pdf.at(-1)));
    }
  }
  report.completedAt=new Date().toISOString();report.status='passed';
}catch(e){report.status='failed';report.error=e instanceof Error?e.message:'failed';process.exitCode=1;}
finally{db.sqlite.close();const i=process.argv.indexOf('--output');if(i>=0)await writeFile(process.argv[i+1],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
