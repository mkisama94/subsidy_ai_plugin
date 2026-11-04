1: import { parseHTML } from 'linkedom';
2: import { permittedUrl } from '../../officialDocuments/sourcePolicy';
3: import { CatalogError, normalize, type CandidatePayload, type SourceConfig, type RecordRow } from '../../officialSubsidyCatalog/types';
4: 
5: export function extractMhlwHtml(html:string,source:SourceConfig,record:RecordRow) {
6:   const {document}=parseHTML(html);
7:   document.querySelectorAll('script,style,noscript,iframe,form,nav,header,footer').forEach((n:{remove():void})=>n.remove());
8:   const root=document.querySelector(source.selector);if(!root)throw new CatalogError('structure_changed');
9:   const text=root.textContent??'';
10:   if(!source.requiredText.every(s=>normalize(text).includes(normalize(s))))throw new CatalogError('required_text_missing');
11:   const links=[...root.querySelectorAll('a[href]')].flatMap(a=>{
12:     try {
13:       const url=new URL(a.getAttribute('href')!,record.url).href;
14:       permittedUrl(url,source.policy,'files');
15:       if(!/\.(?:pdf|docx?|xlsx?|zip)(?:[?#]|$)/i.test(url))return [];
16:       const title=(a.textContent??'').replace(/\s+/g,' ').trim().slice(0,300);if(!title)return [];
17:       return [{url,title,sourcePageUrl:record.url,association:'unconfirmed' as const}];
18:     }catch{return [];}
19:   });
20:   const unique=[...new Map(links.map(x=>[x.url,x])).values()];
21:   const candidates:CandidatePayload[]=[];
22:   for(const course of source.courses) {
23:     const variants=[course.name,...course.aliases];
24:     const blocks=[...root.querySelectorAll('h1,h2,h3,h4,h5,p,li,tr,dt,dd')];
25:     const block=blocks.find(el=>variants.some(s=>normalize(el.textContent??'').includes(normalize(s))));
26:     if(!block)continue;
27:     const excerpt=(block.textContent??'').replace(/\s+/g,' ').trim().slice(0,1000);
28:     const documents=unique.map(d=>({...d,association:variants.some(s=>normalize(d.title).includes(normalize(s)))?'course' as const:'unconfirmed' as const}));
29:     candidates.push({candidateId:course.id,sourceId:source.id,programName:source.programName,courseKey:course.key,courseName:course.name,
30:       title:`${source.programName}（${course.name}）`,summary:'公式ページに制度・コースの記載を確認しました。適用時期と個別条件は公式資料の確認が必要です。',
31:       officialUrl:record.url,fiscalYear:null,state:'unknown',applicationType:'unknown',effectiveFrom:null,effectiveTo:null,eventType:'unknown',
32:       applicabilityNote:'複数年度・改正前後の情報が含まれる可能性があります。取組日に対応する資料を確認してください。',
33:       aliases:course.aliases,purposeTags:course.purposeTags,areas:['全国'],facts:[],documents:documents.slice(0,100),detailLevel:'overview_only',
34:       evidence:[{id:'name',recordId:record.id,field:'courseName',locator:source.selector+' '+block.tagName.toLowerCase(),excerpt,verification:'extracted'}],
35:     });
36:   }
37:   if(!candidates.length)throw new CatalogError('no_courses_extracted');
38:   return {candidates,documents:unique.filter(d=>/\.pdf(?:[?#]|$)/i.test(d.url)).slice(0,source.maxDocuments),
39:     coverage:{registeredCourses:source.courses.length,extractedCourses:candidates.length,discoveredDocuments:unique.length,
40:       queuedDocuments:Math.min(source.maxDocuments,unique.filter(d=>/\.pdf(?:[?#]|$)/i.test(d.url)).length)}};
41: }