import { parseHTML } from 'linkedom';
import { permittedUrl } from '../../officialDocuments/sourcePolicy';
import { CatalogRepository } from '../../officialSubsidyCatalog/repository';
import { CatalogError, type SourceConfig, type SourceRow, type Evidence } from '../../officialSubsidyCatalog/types';
import { MhlwNetwork } from './network';

// Registered common-rule pages are independently observed, even when the course page is 304.
export async function collectDependencies(repo:CatalogRepository,source:SourceRow,config:SourceConfig,network:MhlwNetwork,now:()=>number,token:string) {
  const evidence:Evidence[]=[],documents:{url:string;title:string}[]=[];let changed=false;
  for(const [index,url] of config.dependencyPages.entries()) {
    const previous=await repo.latestRecord(source.id,url),headers:Record<string,string>={Accept:'text/html'};
    // Bodies are needed to rediscover changed attachments; do not persist whole HTML.
    const response=await network.get(url,'pages',headers);
    if(response.status===304)throw new CatalogError('invalid_304');
    const {document}=parseHTML(new TextDecoder().decode(response.bytes));
    document.querySelectorAll('script,style,noscript,iframe,form,nav,header,footer').forEach((n:{remove():void})=>n.remove());
    const main=document.querySelector('main');if(!main)throw new CatalogError('common_structure_changed');
    const heading=main.querySelector('h1,h2')?.textContent?.trim();if(!heading)throw new CatalogError('common_heading_missing');
    if(!await repo.owns(source,token,now()))throw new CatalogError('superseded');
    const record=await repo.record(source.id,response,now());changed ||= previous?.id!==record.id;
    evidence.push({id:`common-${index}`,recordId:record.id,field:'commonRules',locator:'main h1,h2',excerpt:heading.slice(0,1000),verification:'extracted'});
    const links=[...main.querySelectorAll('a[href]')].flatMap(a=>{
      try{const href=new URL(a.getAttribute('href')!,response.url).href;permittedUrl(href,config.policy,'files');
        return /\.pdf(?:[?#]|$)/i.test(href)?[{url:href,title:(a.textContent??'共通要領').trim().slice(0,300)}]:[];
      }catch{return [];}
    });
    // Prefer common provisions and the complete guideline; disclose other documents in the page link.
    documents.push(...links.filter(d=>/共通|通則|全体|全編|支給要領/.test(d.title)).slice(0,5));
  }
  return {evidence,documents:[...new Map(documents.map(d=>[d.url,d])).values()],changed};
}
