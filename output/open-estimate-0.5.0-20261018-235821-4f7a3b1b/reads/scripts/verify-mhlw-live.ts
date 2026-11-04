1: // Official GET requests + ephemeral SQLite only. Never changes remote D1 or publishes a service.
2: import { readFile, writeFile } from 'node:fs/promises';
3: import { catalogDatabase } from '../test/helpers/catalogDatabase';
4: import { CatalogRepository } from '../src/officialSubsidyCatalog/repository';
5: import { sourceFileSchema, type CandidatePayload } from '../src/officialSubsidyCatalog/types';
6: import { collectMhlwSource } from '../src/officialSources/mhlw/collect';
7: import { processPdfJob } from '../src/officialSources/mhlw/pdfWorker';
8: import { discoverSubsidies, getDiscoveredSubsidyDetail } from '../src/subsidyDiscovery/service';
9: 
10: const seeds=sourceFileSchema.parse(JSON.parse(await readFile(new URL('../config/mhlw-sources.json',import.meta.url),'utf8')));
11: const db=catalogDatabase(),repo=new CatalogRepository(db.db),startedAt=new Date().toISOString();
12: const report:any={startedAt,environment:'Node + ephemeral SQLite; official live GET; not Cloudflare production',collections:[],searches:[],pdf:[]};
13: try {
14:   for(const config of seeds.sources){await repo.register(config,Date.now());const r=await collectMhlwSource(repo,(await repo.source(config.id))!);report.collections.push(r);console.log(JSON.stringify(r));}
15:   const versions=(await repo.db.prepare('SELECT * FROM discovery_candidate_versions ORDER BY candidate_id').all<any>()).results;
16:   for(const v of versions)await repo.validate(v.id,'自動照合：実取得HTMLの登録コース名と根拠位置。金額・適用時期は未確認。',Date.now());
17:   if(versions.length!==17)throw new Error(`Expected 17 overview courses, got ${versions.length}`);
18:   report.release=await repo.publish(versions.map(v=>v.id),null,'実地検証専用の一時DB。概要のみの自動検証版。外部提供なし。',Date.now());
19:   const env={subsidy_ai_relations:db.db,MHLW_CATALOG_SERVING_ENABLED:'true'};
20:   const queries=['AI研修','正社員化','採用',...seeds.sources.flatMap(s=>s.courses.map(c=>c.name))];
21:   const timings:number[]=[];
22:   for(const query of queries){const start=performance.now();const r=await discoverSubsidies({query,sources:['mhlw'],limit:50},env);timings.push(performance.now()-start);
23:     const results=[...r.candidates,...r.uncertainCandidates];if(!results.length)throw new Error(`No match: ${query}`);
24:     report.searches.push({query,courses:results.map(c=>c.courseName)});
25:     const named=versions.map(v=>JSON.parse(v.payload_json) as CandidatePayload).find(p=>p.courseName===query);
26:     if(named&&results[0].candidateId!==named.candidateId)throw new Error(`Official name not ranked first: ${query}`);
27:   }
28:   report.latency={samples:timings.length,p95Ms:[...timings].sort((a,b)=>a-b)[Math.ceil(timings.length*.95)-1],scope:'local in-process D1 adapter, not production SLO'};
29:   report.details=[];
30:   for(const v of versions){const detail=await getDiscoveredSubsidyDetail({candidate_id:v.candidate_id,version_id:v.id},env);if(detail.status!=='overview_only')throw new Error(`Bad detail ${detail.status}`);
31:     report.details.push({candidateId:v.candidate_id,status:detail.status,evidenceRecords:(detail.data?.sourceRecords as any[])?.length});}
32:   const jobs=await repo.jobs();report.documents={queued:jobs.length,sample:jobs.slice(0,5).map(j=>({id:j.id,title:j.title,url:j.url}))};
33:   // Opt-in bounded real PDF parsing: pick a short notice and the official complete guidelines.
34:   if(process.argv.includes('--pdf')){
35:     const small=jobs.find(j=>/リーフレット/.test(j.title))??jobs[0];
36:     const large=jobs.find(j=>/全体|全編|19[.,]3/.test(j.title));
37:     for(const job of [small,large].filter((j,i,a)=>j&&a.findIndex(x=>x?.url===j.url)===i)){
38:       const t=performance.now(),r=await processPdfJob(job!.id,{subsidy_ai_relations:db.db,MHLW_INGESTION_ENABLED:'true'});
39:       const stored=await repo.job(job!.id),record=stored?.record_id?await repo.latestRecord(job!.source_id,job!.url):null;
40:       report.pdf.push({url:job!.url,title:job!.title,...r,elapsedMs:performance.now()-t,byteLength:record?.byte_length,contentHash:record?.content_hash,
41:         warnings:stored?.fragments_json?JSON.parse(stored.fragments_json).warnings:[]});console.log(JSON.stringify(report.pdf.at(-1)));
42:     }
43:   }
44:   report.completedAt=new Date().toISOString();report.status='passed';
45: }catch(e){report.status='failed';report.error=e instanceof Error?e.message:'failed';process.exitCode=1;}
46: finally{db.sqlite.close();const i=process.argv.indexOf('--output');if(i>=0)await writeFile(process.argv[i+1],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}