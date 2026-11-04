1: // Read-only live probe. Does not approve a round, write D1, call AI or download full files.
2: import fs from 'node:fs/promises';
3: import {extractHtml} from '../src/officialDocuments/extract.ts';
4: import {createNetwork,fetchResource} from '../src/officialDocuments/sourcePolicy.ts';
5: import {checkLink} from '../src/officialDocuments/linkCheck.ts';
6: const pages=[
7:  ['https://portal.monodukuri-hojo.jp/about.html','公募要領'],
8:  ['https://shinjigyou-shinshutsu.smrj.go.jp/downloads','資料ダウンロード'],
9:  ['https://official.jizokukanb.com/shinsei/','公募要領'],
10: ];
11: const report={checkedAt:new Date().toISOString(),scope:'extraction_and_reachability_only',roundsApproved:false,aiCalled:false,results:[]};
12: for(const [url,required] of pages) {
13:  // The empty cache-busting key was observed on this official page; it is not a session signature.
14:  const host=new URL(url).hostname,policy={pages:[{hostname:host,pathPrefix:'/',queryKeys:[]}],files:[{hostname:host,pathPrefix:'/',queryKeys:[],allowEmptyHexCacheBust:host==='shinjigyou-shinshutsu.smrj.go.jp'}]};
15:  const source={id:crypto.randomUUID(),source_page_url:url};
16:  const config={selector:host==='shinjigyou-shinshutsu.smrj.go.jp'?'.targetRound[aria-label="第4回公募"]':'body',linkSelector:'a[href*=".pdf"],a[href*=".docx"],a[href*=".xlsx"],a[href$=".doc"],a[href$=".xls"]',contextSelector:'li,tr,p,div',
17:    requiredPageText:[required],confirmedContextText:[],excludedContextText:[],associationBasis:'unresolved',version:'live-probe-v1'};
18:  const network=createNetwork({maxRequests:20});
19:  try {
20:   const resource=await fetchResource(url,policy,'pages',network,{maxBytes:2*1024*1024});
21:   if(resource.status!==200)throw new Error(`HTTP ${resource.status}`);
22:   const result=await extractHtml(resource.body,source,config,policy,resource.url);
23:   const byType=new Map();for(const c of result.candidates)if(!byType.has(c.fileType))byType.set(c.fileType,c);
24:   const samples=[];for(const c of [...byType.values()].slice(0,4)) {
25:    const link=await checkLink(c,policy,network,Date.now(),86400000);
26:    samples.push({title:c.originalTitle,fileType:c.fileType,fileUrl:c.fileUrl,sourcePageUrl:c.sourcePageUrl,linkStatus:link.linkStatus,httpStatus:link.linkHttpStatus});
27:   }
28:   report.results.push({sourcePageUrl:url,status:'extracted',candidateCount:result.candidates.length,ignoredCount:result.ignoredCount,samples});
29:  } catch(e){report.results.push({sourcePageUrl:url,status:'failed',reasonCode:e.code??'probe_failed'});}
30: }
31: const i=process.argv.indexOf('--report');if(i>=0)await fs.writeFile(process.argv[i+1],JSON.stringify(report,null,2)+'\n');
32: console.log(JSON.stringify(report,null,2));
33: if(report.results.some(r=>r.status!=='extracted'||!r.candidateCount))process.exitCode=1;