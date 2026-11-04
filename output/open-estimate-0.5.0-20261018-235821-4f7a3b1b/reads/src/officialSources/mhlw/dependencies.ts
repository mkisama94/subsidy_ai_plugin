1: import { parseHTML } from 'linkedom';
2: import { permittedUrl } from '../../officialDocuments/sourcePolicy';
3: import { CatalogRepository } from '../../officialSubsidyCatalog/repository';
4: import { CatalogError, type SourceConfig, type SourceRow, type Evidence } from '../../officialSubsidyCatalog/types';
5: import { MhlwNetwork } from './network';
6: 
7: // Registered common-rule pages are independently observed, even when the course page is 304.
8: export async function collectDependencies(repo:CatalogRepository,source:SourceRow,config:SourceConfig,network:MhlwNetwork,now:()=>number,token:string) {
9:   const evidence:Evidence[]=[],documents:{url:string;title:string}[]=[];let changed=false;
10:   for(const [index,url] of config.dependencyPages.entries()) {
11:     const previous=await repo.latestRecord(source.id,url),headers:Record<string,string>={Accept:'text/html'};
12:     // Bodies are needed to rediscover changed attachments; do not persist whole HTML.
13:     const response=await network.get(url,'pages',headers);
14:     if(response.status===304)throw new CatalogError('invalid_304');
15:     const {document}=parseHTML(new TextDecoder().decode(response.bytes));
16:     document.querySelectorAll('script,style,noscript,iframe,form,nav,header,footer').forEach((n:{remove():void})=>n.remove());
17:     const main=document.querySelector('main');if(!main)throw new CatalogError('common_structure_changed');
18:     const heading=main.querySelector('h1,h2')?.textContent?.trim();if(!heading)throw new CatalogError('common_heading_missing');
19:     if(!await repo.owns(source,token,now()))throw new CatalogError('superseded');
20:     const record=await repo.record(source.id,response,now());changed ||= previous?.id!==record.id;
21:     evidence.push({id:`common-${index}`,recordId:record.id,field:'commonRules',locator:'main h1,h2',excerpt:heading.slice(0,1000),verification:'extracted'});
22:     const links=[...main.querySelectorAll('a[href]')].flatMap(a=>{
23:       try{const href=new URL(a.getAttribute('href')!,response.url).href;permittedUrl(href,config.policy,'files');
24:         return /\.pdf(?:[?#]|$)/i.test(href)?[{url:href,title:(a.textContent??'共通要領').trim().slice(0,300)}]:[];
25:       }catch{return [];}
26:     });
27:     // Prefer common provisions and the complete guideline; disclose other documents in the page link.
28:     documents.push(...links.filter(d=>/共通|通則|全体|全編|支給要領/.test(d.title)).slice(0,5));
29:   }
30:   return {evidence,documents:[...new Map(documents.map(d=>[d.url,d])).values()],changed};
31: }