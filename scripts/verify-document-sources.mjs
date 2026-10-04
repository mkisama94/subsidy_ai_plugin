// Read-only live probe. Does not approve a round, write D1, call AI or download full files.
import fs from 'node:fs/promises';
import {extractHtml} from '../src/officialDocuments/extract.ts';
import {createNetwork,fetchResource} from '../src/officialDocuments/sourcePolicy.ts';
import {checkLink} from '../src/officialDocuments/linkCheck.ts';
const pages=[
 ['https://portal.monodukuri-hojo.jp/about.html','公募要領'],
 ['https://shinjigyou-shinshutsu.smrj.go.jp/downloads','資料ダウンロード'],
 ['https://official.jizokukanb.com/shinsei/','公募要領'],
];
const report={checkedAt:new Date().toISOString(),scope:'extraction_and_reachability_only',roundsApproved:false,aiCalled:false,results:[]};
for(const [url,required] of pages) {
 // The empty cache-busting key was observed on this official page; it is not a session signature.
 const host=new URL(url).hostname,policy={pages:[{hostname:host,pathPrefix:'/',queryKeys:[]}],files:[{hostname:host,pathPrefix:'/',queryKeys:[],allowEmptyHexCacheBust:host==='shinjigyou-shinshutsu.smrj.go.jp'}]};
 const source={id:crypto.randomUUID(),source_page_url:url};
 const config={selector:host==='shinjigyou-shinshutsu.smrj.go.jp'?'.targetRound[aria-label="第4回公募"]':'body',linkSelector:'a[href*=".pdf"],a[href*=".docx"],a[href*=".xlsx"],a[href$=".doc"],a[href$=".xls"]',contextSelector:'li,tr,p,div',
   requiredPageText:[required],confirmedContextText:[],excludedContextText:[],associationBasis:'unresolved',version:'live-probe-v1'};
 const network=createNetwork({maxRequests:20});
 try {
  const resource=await fetchResource(url,policy,'pages',network,{maxBytes:2*1024*1024});
  if(resource.status!==200)throw new Error(`HTTP ${resource.status}`);
  const result=await extractHtml(resource.body,source,config,policy,resource.url);
  const byType=new Map();for(const c of result.candidates)if(!byType.has(c.fileType))byType.set(c.fileType,c);
  const samples=[];for(const c of [...byType.values()].slice(0,4)) {
   const link=await checkLink(c,policy,network,Date.now(),86400000);
   samples.push({title:c.originalTitle,fileType:c.fileType,fileUrl:c.fileUrl,sourcePageUrl:c.sourcePageUrl,linkStatus:link.linkStatus,httpStatus:link.linkHttpStatus});
  }
  report.results.push({sourcePageUrl:url,status:'extracted',candidateCount:result.candidates.length,ignoredCount:result.ignoredCount,samples});
 } catch(e){report.results.push({sourcePageUrl:url,status:'failed',reasonCode:e.code??'probe_failed'});}
}
const i=process.argv.indexOf('--report');if(i>=0)await fs.writeFile(process.argv[i+1],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.results.some(r=>r.status!=='extracted'||!r.candidateCount))process.exitCode=1;
