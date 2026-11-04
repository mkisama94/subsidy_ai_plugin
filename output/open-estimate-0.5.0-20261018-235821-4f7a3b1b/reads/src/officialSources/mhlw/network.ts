1: import { permittedUrl, isPublicAddress, resolvePublicHost } from '../../officialDocuments/sourcePolicy';
2: import type { FetchPolicy } from '../../officialDocuments/types';
3: import { CatalogError, DAY } from '../../officialSubsidyCatalog/types';
4: 
5: export type NetworkOptions = { fetch?:typeof fetch; resolveHost?:(host:string)=>Promise<string[]>;
6:   now?:()=>number; sleep?:(ms:number)=>Promise<void>; dailyLimit?:number; deadline?:number };
7: export type BinaryResource = {status:number;url:string;headers:Headers;bytes:Uint8Array};
8: 
9: export function robotsAllows(body:string,url:URL,userAgent='subsidyai-mhlw'):boolean {
10:   const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];
11:   let current:typeof groups[number]|null=null,hasRules=false;
12:   for(const raw of body.split(/\r?\n/)) {
13:     const line=raw.replace(/#.*/,'').trim(),split=line.indexOf(':');if(split<0)continue;
14:     const key=line.slice(0,split).trim().toLowerCase(),value=line.slice(split+1).trim();
15:     if(key==='user-agent') {
16:       if(!current||hasRules){current={agents:[],rules:[]};groups.push(current);hasRules=false;}
17:       current.agents.push(value.toLowerCase());
18:     } else if(current && ['allow','disallow'].includes(key)) {
19:       hasRules=true;if(value)current.rules.push({allow:key==='allow',path:value});
20:     }
21:   }
22:   const specificity=(g:typeof groups[number])=>Math.max(-1,...g.agents.map(a=>a==='*'?0:userAgent.includes(a)?a.length:-1));
23:   const best=Math.max(-1,...groups.map(specificity));if(best<0)return true;
24:   const target=url.pathname+url.search;
25:   const matching=groups.filter(g=>specificity(g)===best).flatMap(g=>g.rules).filter(r=>{
26:     const end=r.path.endsWith('$'),raw=end?r.path.slice(0,-1):r.path;
27:     const pattern=raw.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
28:     return new RegExp('^'+pattern+(end?'$':'')).test(target);
29:   }).sort((a,b)=>b.path.replace(/[*$]/g,'').length-a.path.replace(/[*$]/g,'').length||Number(b.allow)-Number(a.allow));
30:   return matching[0]?.allow??true;
31: }
32: 
33: export class MhlwNetwork {
34:   readonly now:()=>number;
35:   private readonly fetcher:typeof fetch;
36:   private readonly resolver:(host:string)=>Promise<string[]>;
37:   private readonly sleep:(ms:number)=>Promise<void>;
38:   private readonly deadline:number;
39:   constructor(private db:D1Database,private policy:FetchPolicy,private options:NetworkOptions={}) {
40:     this.now=options.now??Date.now;this.fetcher=options.fetch??((input,init)=>fetch(input,init));
41:     this.resolver=options.resolveHost??resolvePublicHost;
42:     this.sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
43:     this.deadline=options.deadline??this.now()+180_000;
44:   }
45:   private async reserve(host:string) {
46:     for(let attempt=0;attempt<3;attempt++) {
47:       const now=this.now();if(now>=this.deadline)throw new CatalogError('processing_limit');
48:       const day=new Date(now).toISOString().slice(0,10),token=crypto.randomUUID(),limit=this.options.dailyLimit??500;
49:       const row=await this.db.prepare(`INSERT INTO discovery_host_budget(hostname,day,requests,lease_token,lease_until,next_at) VALUES(?,?,1,?,?,0)
50:         ON CONFLICT(hostname) DO UPDATE SET day=excluded.day,requests=CASE WHEN day=excluded.day THEN requests+1 ELSE 1 END,
51:           lease_token=excluded.lease_token,lease_until=excluded.lease_until
52:         WHERE lease_until<=? AND next_at<=? AND (day<>excluded.day OR requests<?) RETURNING hostname`)
53:         .bind(host,day,token,now+75_000,now,now,limit).first();
54:       if(row)return token;
55:       const state=await this.db.prepare('SELECT * FROM discovery_host_budget WHERE hostname=?').bind(host)
56:         .first<{day:string;requests:number;lease_until:number;next_at:number}>();
57:       if(state&&state.day===day&&state.requests>=limit)throw new CatalogError('daily_request_limit',DAY);
58:       const delay=Math.max(state?.next_at??now,state?.lease_until??now)-now;
59:       if(delay>2500 || now+delay>=this.deadline)throw new CatalogError('host_busy',Math.max(2000,delay));
60:       await this.sleep(Math.max(10,delay));
61:     }
62:     throw new CatalogError('host_busy',2000);
63:   }
64:   private async raw(url:URL,headers:Record<string,string>,maxBytes:number,timeout:number):Promise<BinaryResource> {
65:     const token=await this.reserve(url.hostname),controller=new AbortController();
66:     const timer=setTimeout(()=>controller.abort(),Math.min(timeout,Math.max(1,this.deadline-this.now())));
67:     let backoff=2000;
68:     try {
69:       const addresses=await Promise.race([this.resolver(url.hostname),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new CatalogError('timeout')),{once:true}))]);
70:       if(!addresses.length||addresses.some(x=>!isPublicAddress(x)))throw new CatalogError('unsafe_dns');
71:       const response=await this.fetcher(url,{headers:{'User-Agent':'SubsidyAI-MHLW/1.0 (+https://github.com/mkisama94/subsidy_ai_plugin)',...headers},
72:         redirect:'manual',credentials:'omit',signal:controller.signal});
73:       if(response.status===429||response.status===503) {
74:         const retry=response.headers.get('retry-after'),seconds=Number(retry);
75:         backoff=Math.max(2000,retry?(Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-this.now()):60_000);
76:         if(!Number.isFinite(backoff))backoff=60_000;
77:       }
78:       if(!response.ok||response.status===304) {await response.body?.cancel();return {status:response.status,url:url.href,headers:response.headers,bytes:new Uint8Array()};}
79:       const length=Number(response.headers.get('content-length')??0);
80:       if(length>maxBytes){await response.body?.cancel();throw new CatalogError('body_limit');}
81:       const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let count=0;
82:       try {
83:         if(reader)while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>maxBytes)throw new CatalogError('body_limit');chunks.push(value);}
84:       } finally {await reader?.cancel().catch(()=>{});}
85:       const bytes=new Uint8Array(count);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
86:       return {status:response.status,url:url.href,headers:response.headers,bytes};
87:     } catch(error) {
88:       if(error instanceof CatalogError)throw error;
89:       throw new CatalogError(controller.signal.aborted?'timeout':'upstream_error');
90:     } finally {
91:       clearTimeout(timer);
92:       await this.db.prepare('UPDATE discovery_host_budget SET lease_until=0,lease_token=NULL,next_at=? WHERE hostname=? AND lease_token=?')
93:         .bind(this.now()+backoff,url.hostname,token).run();
94:     }
95:   }
96:   private async robots(url:URL) {
97:     const cached=await this.db.prepare('SELECT body,checked_at FROM discovery_robots WHERE hostname=?').bind(url.hostname).first<{body:string;checked_at:number}>();
98:     let body=cached?.body;
99:     if(!cached||cached.checked_at+DAY<=this.now()) {
100:       const r=await this.raw(new URL('/robots.txt',url),{Accept:'text/plain'},256*1024,15_000);
101:       if(r.status===404)body='';
102:       else if(r.status===200 && !(r.headers.get('content-type')??'').includes('html'))body=new TextDecoder().decode(r.bytes);
103:       else throw new CatalogError('robots_unavailable',60_000);
104:       await this.db.prepare(`INSERT INTO discovery_robots(hostname,body,checked_at) VALUES(?,?,?) ON CONFLICT(hostname) DO UPDATE SET body=excluded.body,checked_at=excluded.checked_at`)
105:         .bind(url.hostname,body,this.now()).run();
106:     }
107:     if(!robotsAllows(body??'',url))throw new CatalogError('robots_denied');
108:   }
109:   async get(raw:string,kind:'pages'|'files',headers:Record<string,string>={}):Promise<BinaryResource> {
110:     for(let hop=0;hop<=3;hop++) {
111:       let url:URL;try{url=permittedUrl(raw,this.policy,kind);}catch{throw new CatalogError('unsafe_url');}
112:       await this.robots(url);
113:       const response=await this.raw(url,headers,kind==='pages'?2*1024*1024:30*1024*1024,kind==='pages'?15_000:60_000);
114:       if([301,302,303,307,308].includes(response.status)) {
115:         const location=response.headers.get('location');if(!location||hop===3)throw new CatalogError('redirect_limit');
116:         raw=new URL(location,url).href;headers={};continue;
117:       }
118:       if(response.status===304)return response;
119:       if(response.status!==200) {
120:         const state=await this.db.prepare('SELECT next_at FROM discovery_host_budget WHERE hostname=?').bind(url.hostname).first<{next_at:number}>();
121:         throw new CatalogError(`http_${response.status}`,Math.max(0,(state?.next_at??0)-this.now()));
122:       }
123:       const mime=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
124:       if(kind==='pages'&&!['text/html','application/xhtml+xml'].includes(mime))throw new CatalogError('invalid_html_mime');
125:       if(kind==='files'&&(mime!=='application/pdf'||new TextDecoder().decode(response.bytes.slice(0,5))!=='%PDF-'))throw new CatalogError('invalid_pdf');
126:       if(!response.bytes.length)throw new CatalogError('empty_body');
127:       return response;
128:     }
129:     throw new CatalogError('redirect_limit');
130:   }
131: }