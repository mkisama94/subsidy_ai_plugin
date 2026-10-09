import { permittedUrl, isPublicAddress, resolvePublicHost } from '../../officialDocuments/sourcePolicy';
import type { FetchPolicy } from '../../officialDocuments/types';
import { CatalogError, DAY } from '../../officialSubsidyCatalog/types';

export type NetworkOptions = { fetch?:typeof fetch; resolveHost?:(host:string)=>Promise<string[]>;
  now?:()=>number; sleep?:(ms:number)=>Promise<void>; dailyLimit?:number; deadline?:number };
export type BinaryResource = {status:number;url:string;headers:Headers;bytes:Uint8Array};

export function robotsAllows(body:string,url:URL,userAgent='subsidyai-mhlw'):boolean {
  const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];
  let current:typeof groups[number]|null=null,hasRules=false;
  for(const raw of body.split(/\r?\n/)) {
    const line=raw.replace(/#.*/,'').trim(),split=line.indexOf(':');if(split<0)continue;
    const key=line.slice(0,split).trim().toLowerCase(),value=line.slice(split+1).trim();
    if(key==='user-agent') {
      if(!current||hasRules){current={agents:[],rules:[]};groups.push(current);hasRules=false;}
      current.agents.push(value.toLowerCase());
    } else if(current && ['allow','disallow'].includes(key)) {
      hasRules=true;if(value)current.rules.push({allow:key==='allow',path:value});
    }
  }
  const specificity=(g:typeof groups[number])=>Math.max(-1,...g.agents.map(a=>a==='*'?0:userAgent.includes(a)?a.length:-1));
  const best=Math.max(-1,...groups.map(specificity));if(best<0)return true;
  const target=url.pathname+url.search;
  const matching=groups.filter(g=>specificity(g)===best).flatMap(g=>g.rules).filter(r=>{
    const end=r.path.endsWith('$'),raw=end?r.path.slice(0,-1):r.path;
    const pattern=raw.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
    return new RegExp('^'+pattern+(end?'$':'')).test(target);
  }).sort((a,b)=>b.path.replace(/[*$]/g,'').length-a.path.replace(/[*$]/g,'').length||Number(b.allow)-Number(a.allow));
  return matching[0]?.allow??true;
}

export class MhlwNetwork {
  readonly now:()=>number;
  private readonly fetcher:typeof fetch;
  private readonly resolver:(host:string)=>Promise<string[]>;
  private readonly sleep:(ms:number)=>Promise<void>;
  private readonly deadline:number;
  constructor(private db:D1Database,private policy:FetchPolicy,private options:NetworkOptions={}) {
    this.now=options.now??Date.now;this.fetcher=options.fetch??((input,init)=>fetch(input,init));
    this.resolver=options.resolveHost??resolvePublicHost;
    this.sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
    this.deadline=options.deadline??this.now()+180_000;
  }
  private async reserve(host:string) {
    for(let attempt=0;attempt<3;attempt++) {
      const now=this.now();if(now>=this.deadline)throw new CatalogError('processing_limit');
      const day=new Date(now).toISOString().slice(0,10),token=crypto.randomUUID(),limit=this.options.dailyLimit??500;
      const row=await this.db.prepare(`INSERT INTO discovery_host_budget(hostname,day,requests,lease_token,lease_until,next_at) VALUES(?,?,1,?,?,0)
        ON CONFLICT(hostname) DO UPDATE SET day=excluded.day,requests=CASE WHEN day=excluded.day THEN requests+1 ELSE 1 END,
          lease_token=excluded.lease_token,lease_until=excluded.lease_until
        WHERE lease_until<=? AND next_at<=? AND (day<>excluded.day OR requests<?) RETURNING hostname`)
        .bind(host,day,token,now+75_000,now,now,limit).first();
      if(row)return token;
      const state=await this.db.prepare('SELECT * FROM discovery_host_budget WHERE hostname=?').bind(host)
        .first<{day:string;requests:number;lease_until:number;next_at:number}>();
      if(state&&state.day===day&&state.requests>=limit)throw new CatalogError('daily_request_limit',DAY);
      const delay=Math.max(state?.next_at??now,state?.lease_until??now)-now;
      if(delay>2500 || now+delay>=this.deadline)throw new CatalogError('host_busy',Math.max(2000,delay));
      await this.sleep(Math.max(10,delay));
    }
    throw new CatalogError('host_busy',2000);
  }
  private async raw(url:URL,headers:Record<string,string>,maxBytes:number,timeout:number):Promise<BinaryResource> {
    const token=await this.reserve(url.hostname),controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.min(timeout,Math.max(1,this.deadline-this.now())));
    let backoff=2000;
    try {
      const addresses=await Promise.race([this.resolver(url.hostname),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new CatalogError('timeout')),{once:true}))]);
      if(!addresses.length||addresses.some(x=>!isPublicAddress(x)))throw new CatalogError('unsafe_dns');
      const response=await this.fetcher(url,{headers:{'User-Agent':'SubsidyAI-MHLW/1.0 (+https://github.com/mkisama94/subsidy_ai_plugin)',...headers},
        redirect:'manual',credentials:'omit',signal:controller.signal});
      if(response.status===429||response.status===503) {
        const retry=response.headers.get('retry-after'),seconds=Number(retry);
        backoff=Math.max(2000,retry?(Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-this.now()):60_000);
        if(!Number.isFinite(backoff))backoff=60_000;
      }
      if(!response.ok||response.status===304) {await response.body?.cancel();return {status:response.status,url:url.href,headers:response.headers,bytes:new Uint8Array()};}
      const length=Number(response.headers.get('content-length')??0);
      if(length>maxBytes){await response.body?.cancel();throw new CatalogError('body_limit');}
      const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let count=0;
      try {
        if(reader)while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>maxBytes)throw new CatalogError('body_limit');chunks.push(value);}
      } finally {await reader?.cancel().catch(()=>{});}
      const bytes=new Uint8Array(count);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      return {status:response.status,url:url.href,headers:response.headers,bytes};
    } catch(error) {
      if(error instanceof CatalogError)throw error;
      throw new CatalogError(controller.signal.aborted?'timeout':'upstream_error');
    } finally {
      clearTimeout(timer);
      await this.db.prepare('UPDATE discovery_host_budget SET lease_until=0,lease_token=NULL,next_at=? WHERE hostname=? AND lease_token=?')
        .bind(this.now()+backoff,url.hostname,token).run();
    }
  }
  private async robots(url:URL) {
    const cached=await this.db.prepare('SELECT body,checked_at FROM discovery_robots WHERE hostname=?').bind(url.hostname).first<{body:string;checked_at:number}>();
    let body=cached?.body;
    if(!cached||cached.checked_at+DAY<=this.now()) {
      const r=await this.raw(new URL('/robots.txt',url),{Accept:'text/plain'},256*1024,15_000);
      if(r.status===404)body='';
      else if(r.status===200 && !(r.headers.get('content-type')??'').includes('html'))body=new TextDecoder().decode(r.bytes);
      else throw new CatalogError('robots_unavailable',60_000);
      await this.db.prepare(`INSERT INTO discovery_robots(hostname,body,checked_at) VALUES(?,?,?) ON CONFLICT(hostname) DO UPDATE SET body=excluded.body,checked_at=excluded.checked_at`)
        .bind(url.hostname,body,this.now()).run();
    }
    if(!robotsAllows(body??'',url))throw new CatalogError('robots_denied');
  }
  async get(raw:string,kind:'pages'|'files',headers:Record<string,string>={}):Promise<BinaryResource> {
    for(let hop=0;hop<=3;hop++) {
      let url:URL;try{url=permittedUrl(raw,this.policy,kind);}catch{throw new CatalogError('unsafe_url');}
      await this.robots(url);
      const response=await this.raw(url,headers,kind==='pages'?2*1024*1024:30*1024*1024,kind==='pages'?15_000:60_000);
      if([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get('location');if(!location||hop===3)throw new CatalogError('redirect_limit');
        raw=new URL(location,url).href;headers={};continue;
      }
      if(response.status===304)return response;
      if(response.status!==200) {
        const state=await this.db.prepare('SELECT next_at FROM discovery_host_budget WHERE hostname=?').bind(url.hostname).first<{next_at:number}>();
        throw new CatalogError(`http_${response.status}`,Math.max(0,(state?.next_at??0)-this.now()));
      }
      const mime=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
      if(kind==='pages'&&!['text/html','application/xhtml+xml'].includes(mime))throw new CatalogError('invalid_html_mime');
      if(kind==='files'&&(mime!=='application/pdf'||new TextDecoder().decode(response.bytes.slice(0,5))!=='%PDF-'))throw new CatalogError('invalid_pdf');
      if(!response.bytes.length)throw new CatalogError('empty_body');
      return response;
    }
    throw new CatalogError('redirect_limit');
  }
}
