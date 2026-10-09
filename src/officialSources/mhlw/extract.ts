import { parseHTML } from 'linkedom';
import { permittedUrl } from '../../officialDocuments/sourcePolicy';
import { CatalogError, normalize, type CandidatePayload, type SourceConfig, type RecordRow } from '../../officialSubsidyCatalog/types';

export function extractMhlwHtml(html:string,source:SourceConfig,record:RecordRow) {
  const {document}=parseHTML(html);
  document.querySelectorAll('script,style,noscript,iframe,form,nav,header,footer').forEach((n:{remove():void})=>n.remove());
  const root=document.querySelector(source.selector);if(!root)throw new CatalogError('structure_changed');
  const text=root.textContent??'';
  if(!source.requiredText.every(s=>normalize(text).includes(normalize(s))))throw new CatalogError('required_text_missing');
  const links=[...root.querySelectorAll('a[href]')].flatMap(a=>{
    try {
      const url=new URL(a.getAttribute('href')!,record.url).href;
      permittedUrl(url,source.policy,'files');
      if(!/\.(?:pdf|docx?|xlsx?|zip)(?:[?#]|$)/i.test(url))return [];
      const title=(a.textContent??'').replace(/\s+/g,' ').trim().slice(0,300);if(!title)return [];
      return [{url,title,sourcePageUrl:record.url,association:'unconfirmed' as const}];
    }catch{return [];}
  });
  const unique=[...new Map(links.map(x=>[x.url,x])).values()];
  const candidates:CandidatePayload[]=[];
  for(const course of source.courses) {
    const variants=[course.name,...course.aliases];
    const blocks=[...root.querySelectorAll('h1,h2,h3,h4,h5,p,li,tr,dt,dd')];
    const block=blocks.find(el=>variants.some(s=>normalize(el.textContent??'').includes(normalize(s))));
    if(!block)continue;
    const excerpt=(block.textContent??'').replace(/\s+/g,' ').trim().slice(0,1000);
    const documents=unique.map(d=>({...d,association:variants.some(s=>normalize(d.title).includes(normalize(s)))?'course' as const:'unconfirmed' as const}));
    candidates.push({candidateId:course.id,sourceId:source.id,programName:source.programName,courseKey:course.key,courseName:course.name,
      title:`${source.programName}（${course.name}）`,summary:'公式ページに制度・コースの記載を確認しました。適用時期と個別条件は公式資料の確認が必要です。',
      officialUrl:record.url,fiscalYear:null,state:'unknown',applicationType:'unknown',effectiveFrom:null,effectiveTo:null,eventType:'unknown',
      applicabilityNote:'複数年度・改正前後の情報が含まれる可能性があります。取組日に対応する資料を確認してください。',
      aliases:course.aliases,purposeTags:course.purposeTags,areas:['全国'],facts:[],documents:documents.slice(0,100),detailLevel:'overview_only',
      evidence:[{id:'name',recordId:record.id,field:'courseName',locator:source.selector+' '+block.tagName.toLowerCase(),excerpt,verification:'extracted'}],
    });
  }
  if(!candidates.length)throw new CatalogError('no_courses_extracted');
  return {candidates,documents:unique.filter(d=>/\.pdf(?:[?#]|$)/i.test(d.url)).slice(0,source.maxDocuments),
    coverage:{registeredCourses:source.courses.length,extractedCourses:candidates.length,discoveredDocuments:unique.length,
      queuedDocuments:Math.min(source.maxDocuments,unique.filter(d=>/\.pdf(?:[?#]|$)/i.test(d.url)).length)}};
}
