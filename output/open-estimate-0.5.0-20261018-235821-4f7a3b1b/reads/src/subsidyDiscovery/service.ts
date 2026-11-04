1: import { z } from 'zod';
2: import { D1PublicApiCache, createPrivateCacheKey, type PublicApiCache } from '../cache';
3: import { getSubsidyDetail, searchSubsidies, type JGrantsCacheOptions } from '../jgrants';
4: import { CatalogRepository } from '../officialSubsidyCatalog/repository';
5: import { DAY, CatalogError, digest, enabled, iso, normalize, payloadSchema, type CandidatePayload, type CatalogEnv, type VersionRow } from '../officialSubsidyCatalog/types';
6: 
7: export const searchInputSchema=z.object({
8:   query:z.string().trim().min(2).max(255),target_area:z.string().trim().min(1).max(100).optional(),
9:   purpose_tags:z.array(z.string().trim().min(1).max(100)).max(10).default([]),
10:   sources:z.array(z.enum(['jgrants','mhlw'])).min(1).max(2).default(['jgrants','mhlw']),
11:   status_scope:z.enum(['active_and_scheduled','active_only','all']).default('active_and_scheduled'),
12:   limit:z.number().int().min(1).max(50).default(10),cursor:z.string().max(1500).optional(),
13: }).strict();
14: export const detailInputSchema=z.object({candidate_id:z.string().min(1).max(150).regex(/^[a-zA-Z0-9_-]+$/),
15:   version_id:z.string().min(1).max(150).regex(/^[a-zA-Z0-9_-]+$/).optional(),event_date:z.string().date().optional(),
16:   event_type:z.enum(['training_start','hiring','conversion','leave_start','other']).optional()}).strict();
17: const candidateSchema=z.object({candidateId:z.string(),versionId:z.string(),source:z.enum(['mhlw','jgrants']),title:z.string(),
18:   courseName:z.string().nullable(),fiscalYear:z.number().nullable(),summary:z.string(),state:z.enum(['active','scheduled','closed','unknown']),
19:   applicationType:z.string(),officialUrl:z.string(),matchReasons:z.array(z.string()),detailStatus:z.string(),
20:   freshness:z.enum(['fresh','stale','unknown']),lastVerifiedAt:z.string().nullable(),freshUntil:z.string().nullable(),
21:   sourceWarnings:z.array(z.string()),jgrantsId:z.string().nullable(),score:z.number()});
22: type Candidate=z.infer<typeof candidateSchema>;
23: const coverageSchema=z.object({status:z.enum(['success','partial','failed','not_queried']),reasonCode:z.string().nullable(),
24:   registeredCourses:z.number().nullable(),publishedCourses:z.number().nullable(),fetchedCount:z.number(),upstreamCount:z.number().nullable(),
25:   unparsedDocuments:z.number().nullable(),warnings:z.array(z.string())});
26: type Coverage=z.infer<typeof coverageSchema>;
27: export const searchOutputSchema=z.object({schemaVersion:z.literal('1'),catalogReleaseId:z.string().nullable(),
28:   candidates:z.array(candidateSchema),uncertainCandidates:z.array(candidateSchema),coverage:z.object({jgrants:coverageSchema,mhlw:coverageSchema}),
29:   counts:z.object({fetched:z.number(),deduplicated:z.number(),filtered:z.number(),matching:z.number(),returned:z.number()}),
30:   hasMore:z.boolean(),nextCursor:z.string().nullable(),servedAt:z.string(),responseGuidance:z.string(),warnings:z.array(z.string())});
31: export const detailOutputSchema=z.object({schemaVersion:z.literal('1'),status:z.string(),candidateId:z.string(),versionId:z.string().nullable(),
32:   catalogReleaseId:z.string().nullable(),data:z.record(z.string(),z.unknown()).nullable(),missingFacts:z.array(z.string()),
33:   warnings:z.array(z.string()),responseGuidance:z.string(),servedAt:z.string()});
34: 
35: const GUIDANCE='Jグランツと登録済み厚労省公式情報の検索です。0件を制度不存在とせず、coverage、適用時期、確認日時を示してください。厚労省のcandidateIdはget_discovered_subsidy_detailに渡し、Jグランツ専用の詳細・適合度評価へ渡さないでください。現行制度でも個別の申請可否は未判定です。';
36: export const DISCOVERY_GUIDANCE='採用・研修等では、discover_subsidiesが利用可能なら厚労省カタログも検索してください。利用できなければ従来どおり標準Web検索で公式情報を補完し、未確認の範囲を明示してください。';
37: const emptyCoverage=(status:Coverage['status'],reasonCode:string|null=null):Coverage=>({status,reasonCode,registeredCourses:null,publishedCourses:null,
38:   fetchedCount:0,upstreamCount:null,unparsedDocuments:null,warnings:[]});
39: type Snapshot={catalogReleaseId:string|null;candidates:Candidate[];coverage:{jgrants:Coverage;mhlw:Coverage};counts:{fetched:number;deduplicated:number;filtered:number;matching:number};
40:   warnings:string[];queryHash:string;expiresAt:number};
41: type Resolver={id:string;versionId:string;title:string;acceptanceStart:string|null;acceptanceEnd:string|null;expiresAt:number};
42: export type DiscoveryOptions={now?:()=>number;search?:typeof searchSubsidies;detail?:typeof getSubsidyDetail;cache?:PublicApiCache};
43: const queryIdentity=(q:z.infer<typeof searchInputSchema>)=>({query:q.query,target_area:q.target_area??null,purpose_tags:[...q.purpose_tags].sort(),sources:[...new Set(q.sources)].sort(),status_scope:q.status_scope,limit:q.limit});
44: 
45: export function matchCandidate(payload:CandidatePayload,query:string,tags:string[]) {
46:   const q=normalize(query),name=normalize(payload.title),aliases=payload.aliases.map(normalize),purposes=payload.purposeTags.map(normalize);
47:   if(name===q||normalize(payload.courseName)===q)return {score:100,reasons:['正式名称一致']};
48:   if(aliases.includes(q))return {score:90,reasons:['確認対象の別名一致']};
49:   if(name.includes(q))return {score:80,reasons:['制度名・コース名に一致']};
50:   const terms=[...query.split(/[\s、,・]+/),...tags].map(normalize).filter(x=>x.length>=2);
51:   const dictionary:Record<string,string[]>={ai研修:['ai','研修','人材育成'],採用:['雇入れ','採用'],正社員化:['正社員','転換'],リスキリング:['リスキリング','研修']};
52:   terms.push(...(dictionary[q]??[]));
53:   const matched=terms.filter(t=>[name,...aliases,...purposes].some(x=>x.includes(t)||t.includes(x)&&x.length>=2));
54:   if(matched.length)return {score:40+Math.min(20,matched.length*3),reasons:['目的・名称の語句一致（申請資格は未判定）']};
55:   return null;
56: }
57: 
58: async function observe(repo:CatalogRepository,v:VersionRow,p:CandidatePayload,now:number) {
59:   const records=await repo.evidenceRecords(v.id),source=await repo.source(p.sourceId),warnings:string[]=[];
60:   const checked=records.length?Math.min(...records.map(r=>r.last_verified_at)):null;
61:   let pending=source?.revision!==v.source_revision;
62:   for(const record of records) {
63:     const latest=await repo.latestRecord(p.sourceId,record.url);if(latest&&latest.content_hash!==record.content_hash)pending=true;
64:   }
65:   if(source?.last_error)warnings.push(`source_${source.last_error}`);
66:   if(!source||source.status==='paused')warnings.push('source_paused');
67:   const stale=checked===null||checked+2*DAY<=now;
68:   return {detailStatus:!source||source.status==='paused'?'unavailable':pending?'update_pending':stale?'stale':p.detailLevel==='conditions_reviewed'?'available':'overview_only',
69:     freshness:(checked===null?'unknown':stale?'stale':'fresh') as Candidate['freshness'],lastVerifiedAt:checked===null?null:iso(checked),freshUntil:checked===null?null:iso(checked+2*DAY),sourceWarnings:warnings};
70: }
71: function cacheFor(env:CatalogEnv,options:DiscoveryOptions) {return options.cache??((env.PUBLIC_CACHE??env.subsidy_ai_relations)?new D1PublicApiCache((env.PUBLIC_CACHE??env.subsidy_ai_relations)!):undefined);}
72: function cacheOptions(env:CatalogEnv,options:DiscoveryOptions):JGrantsCacheOptions{return {cache:cacheFor(env,options),searchCacheKeySecret:env.CACHE_KEY_SECRET,now:options.now};}
73: 
74: async function mhlwCandidates(env:CatalogEnv,q:z.infer<typeof searchInputSchema>,now:number) {
75:   if(!enabled(env.MHLW_CATALOG_SERVING_ENABLED))return {items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('not_queried','catalog_disabled')};
76:   if(!env.subsidy_ai_relations)return {items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('failed','database_not_configured')};
77:   try {
78:     const repo=new CatalogRepository(env.subsidy_ai_relations),releaseId=await repo.activeId(),sources=await repo.sources();
79:     const registered=sources.reduce((n,s)=>n+JSON.parse(s.config_json).courses.length,0);
80:     if(!releaseId)return {items:[] as Candidate[],releaseId:null,coverage:{...emptyCoverage('partial','not_indexed'),registeredCourses:registered,publishedCourses:0}};
81:     const versions=await repo.published(releaseId),items:Candidate[]=[];
82:     for(const v of versions) {
83:       const p=payloadSchema.parse(JSON.parse(v.payload_json)),match=matchCandidate(p,q.query,q.purpose_tags);
84:       if(!match)continue;
85:       if(q.target_area&&!p.areas.includes('全国')&&!p.areas.some(a=>normalize(q.target_area!).includes(normalize(a))))continue;
86:       const observed=await observe(repo,v,p,now);if(observed.detailStatus==='unavailable')continue;
87:       const mapping=await repo.db.prepare('SELECT jgrants_id FROM discovery_candidates WHERE id=?').bind(p.candidateId).first<{jgrants_id:string|null}>();
88:       items.push({candidateId:p.candidateId,versionId:v.id,source:'mhlw',title:p.title,courseName:p.courseName,fiscalYear:p.fiscalYear,
89:         summary:p.summary,state:p.state,applicationType:p.applicationType,officialUrl:p.officialUrl,matchReasons:match.reasons,score:match.score,jgrantsId:mapping?.jgrants_id??null,...observed});
90:     }
91:     const jobs=(await repo.jobs()).filter(j=>sources.some(s=>s.id===j.source_id&&s.revision===j.source_revision)),unparsed=jobs.filter(j=>j.status!=='ready').length;
92:     const partial=versions.length<registered||unparsed>0||sources.some(s=>s.last_error||s.status!=='approved')||items.some(i=>i.detailStatus!=='available');
93:     return {items,releaseId,coverage:{status:partial?'partial':'success',reasonCode:null,registeredCourses:registered,publishedCourses:versions.length,
94:       fetchedCount:versions.length,upstreamCount:null,unparsedDocuments:unparsed,warnings:['registered_sources_only','document_discovery_bounded','eligibility_not_assessed']} as Coverage};
95:   }catch{return {items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('failed','catalog_database_unavailable')};}
96: }
97: 
98: export async function discoverSubsidies(raw:unknown,env:CatalogEnv,options:DiscoveryOptions={}) {
99:   const q=searchInputSchema.parse(raw),now=(options.now??Date.now)(),cache=cacheFor(env,options),secret=env.CACHE_KEY_SECRET;
100:   const queryHash=secret?await createPrivateCacheKey('discovery-query-v1',queryIdentity(q),secret):await digest(JSON.stringify(queryIdentity(q)));
101:   let snapshot:Snapshot,offset=0,snapshotId:string=crypto.randomUUID();
102:   if(q.cursor) {
103:     if(!cache||!secret)throw new CatalogError('cursor_unavailable');
104:     let c:{id:string;offset:number;signature:string};
105:     try{c=JSON.parse(atob(q.cursor));}catch{throw new CatalogError('invalid_cursor');}
106:     if(!z.object({id:z.string().uuid(),offset:z.number().int().min(0).max(10000),signature:z.string()}).strict().safeParse(c).success)throw new CatalogError('invalid_cursor');
107:     if(c.signature!==await createPrivateCacheKey('discovery-cursor-v1',[c.id,c.offset,queryHash],secret))throw new CatalogError('cursor_query_mismatch');
108:     const stored=await cache.get<Snapshot>(`discovery:snapshot:${c.id}`);
109:     if(!stored||stored.expiresAt<=now||stored.value.queryHash!==queryHash)throw new CatalogError('cursor_expired');
110:     snapshot=stored.value;snapshotId=c.id;offset=c.offset;
111:     if(q.sources.includes('mhlw')&&!enabled(env.MHLW_CATALOG_SERVING_ENABLED))throw new CatalogError('catalog_disabled');
112:   } else {
113:     const [m,j]=await Promise.allSettled([
114:       q.sources.includes('mhlw')?mhlwCandidates(env,q,now):Promise.resolve({items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('not_queried')}),
115:       q.sources.includes('jgrants')?(options.search??searchSubsidies)({keyword:q.query,targetArea:q.target_area,acceptingOnly:false,sort:'acceptance_end_datetime',order:'ASC',limit:50},cacheOptions(env,options)):Promise.resolve(null),
116:     ]);
117:     const mh=m.status==='fulfilled'?m.value:{items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('failed','catalog_unavailable')};
118:     const jg=j.status==='fulfilled'?j.value:null,jgItems:Candidate[]=[],warnings:string[]=[];
119:     let jcov=q.sources.includes('jgrants')?emptyCoverage('failed','upstream_error'):emptyCoverage('not_queried');
120:     if(jg) {
121:       jcov={...emptyCoverage(jg.hasMore||jg.cache.isStale?'partial':'success'),fetchedCount:jg.returnedCount,upstreamCount:jg.upstreamCount,warnings:jg.hasMore?['upstream_results_truncated']:[]};
122:       for(const s of jg.subsidies) {
123:         const candidateId='jg_'+(await digest(s.id)).slice(0,40),versionId=await digest(JSON.stringify([s.title,s.acceptanceStart,s.acceptanceEnd]));
124:         jgItems.push({candidateId,versionId,source:'jgrants',title:s.title,courseName:null,fiscalYear:null,summary:'Jグランツの公開検索結果。詳細条件は詳細取得で確認してください。',
125:           state:s.acceptanceStatus==='open'?'active':s.acceptanceStatus,applicationType:'fixed',officialUrl:s.detailUrl,matchReasons:['Jグランツ検索一致'],
126:           detailStatus:jg.cache.isStale?'stale':'overview_only',freshness:jg.cache.isStale?'stale':'fresh',lastVerifiedAt:jg.retrievedAt,freshUntil:jg.cache.expiresAt,
127:           sourceWarnings:jg.cache.isStale?['upstream_cache_stale']:[],jgrantsId:s.id,score:normalize(s.title)===normalize(q.query)?100:50});
128:         if(cache)try{await cache.put<Resolver>(`discovery:resolver:${candidateId}:${versionId}`,'jgrants','discovery_resolver',{
129:           value:{id:s.id,versionId,title:s.title,acceptanceStart:s.acceptanceStart,acceptanceEnd:s.acceptanceEnd,expiresAt:now+30*60_000},fetchedAt:now,expiresAt:now+30*60_000,staleUntil:now+30*60_000});}
130:         catch{warnings.push('detail_context_not_saved');}
131:       }
132:     }
133:     const mapped=new Set(mh.items.map(i=>i.jgrantsId).filter(Boolean));
134:     const all=[...mh.items,...jgItems.filter(i=>!mapped.has(i.jgrantsId))];
135:     const filtered=all.filter(c=>q.status_scope==='all'||c.state==='unknown'||c.state==='active'||q.status_scope==='active_and_scheduled'&&c.state==='scheduled');
136:     filtered.sort((a,b)=>b.score-a.score||a.candidateId.localeCompare(b.candidateId));
137:     snapshot={catalogReleaseId:mh.releaseId,candidates:filtered,coverage:{mhlw:mh.coverage,jgrants:jcov},
138:       counts:{fetched:mh.coverage.fetchedCount+jgItems.length,deduplicated:mh.items.length+jgItems.length-all.length,filtered:all.length-filtered.length,matching:filtered.length},
139:       queryHash,expiresAt:now+30*60_000,warnings:[...new Set(warnings)]};
140:     if(cache&&secret)try{await cache.put(`discovery:snapshot:${snapshotId}`,'discovery','search_snapshot',{value:snapshot,fetchedAt:now,expiresAt:snapshot.expiresAt,staleUntil:snapshot.expiresAt});}
141:     catch{snapshot.warnings.push('pagination_unavailable');}
142:     else if(filtered.length>q.limit)snapshot.warnings.push('pagination_requires_cache_and_secret');
143:   }
144:   const slice=await Promise.all(snapshot.candidates.slice(offset,offset+q.limit).map(async c=>{
145:     if(q.cursor&&c.source==='mhlw') {
146:       try{if(!env.subsidy_ai_relations)throw new Error();const repo=new CatalogRepository(env.subsidy_ai_relations),v=await repo.version(c.versionId);
147:         if(!v)throw new Error();return {...c,...await observe(repo,v,payloadSchema.parse(JSON.parse(v.payload_json)),now)};
148:       }catch{return {...c,detailStatus:'unavailable',sourceWarnings:['catalog_database_unavailable']};}
149:     }
150:     return c.freshUntil&&Date.parse(c.freshUntil)<=now?{...c,freshness:'stale' as const,detailStatus:['unavailable','update_pending'].includes(c.detailStatus)?c.detailStatus:'stale'}:c;
151:   }));
152:   const more=offset+q.limit<snapshot.candidates.length,canPage=!!cache&&!!secret&&!snapshot.warnings.some(w=>w.startsWith('pagination_'));
153:   const nextCursor=more&&canPage?btoa(JSON.stringify({id:snapshotId,offset:offset+q.limit,signature:await createPrivateCacheKey('discovery-cursor-v1',[snapshotId,offset+q.limit,queryHash],secret!)})):null;
154:   return searchOutputSchema.parse({schemaVersion:'1',catalogReleaseId:snapshot.catalogReleaseId,candidates:slice.filter(c=>c.state!=='unknown'),uncertainCandidates:slice.filter(c=>c.state==='unknown'),
155:     coverage:snapshot.coverage,counts:{...snapshot.counts,returned:slice.length},hasMore:!!nextCursor,nextCursor,servedAt:iso(now),responseGuidance:GUIDANCE,warnings:snapshot.warnings});
156: }
157: 
158: export async function getDiscoveredSubsidyDetail(raw:unknown,env:CatalogEnv,options:DiscoveryOptions={}) {
159:   const input=detailInputSchema.parse(raw),now=(options.now??Date.now)();
160:   const result={schemaVersion:'1' as const,status:'unavailable',candidateId:input.candidate_id,versionId:input.version_id??null,catalogReleaseId:null as string|null,
161:     data:null as Record<string,unknown>|null,missingFacts:[] as string[],warnings:[] as string[],responseGuidance:GUIDANCE,servedAt:iso(now)};
162:   if(input.candidate_id.startsWith('jg_')) {
163:     const cache=cacheFor(env,options);
164:     const resolver=input.version_id&&cache?await cache.get<Resolver>(`discovery:resolver:${input.candidate_id}:${input.version_id}`):null;
165:     if(!resolver||resolver.expiresAt<=now)return {...result,status:'candidate_context_expired',missingFacts:['制度を再検索してください。']};
166:     try {
167:       const detail=await (options.detail??getSubsidyDetail)(resolver.value.id,cacheOptions(env,options));
168:       const data=detail as Record<string,unknown>;
169:       // Compare the fields the current JGrants normalizer exposes, retaining both observation times.
170:       const d=(data.subsidy??data) as Record<string,unknown>;
171:       const changed=typeof d.title==='string'&&d.title!==resolver.value.title ||
172:         Array.isArray(d.workflows)&&!d.workflows.some(w=>w.acceptanceStart===resolver.value.acceptanceStart&&w.acceptanceEnd===resolver.value.acceptanceEnd);
173:       const stale=detail.cache.isStale;
174:       return {...result,status:changed?'changed_since_search':stale?'stale':'available',data:{...data,searchObservation:resolver.value},warnings:[...(changed?['検索時から名称・受付期間が変わったか、期間の対応を確認できません。']:[]),...(stale?['upstream_cache_stale']:[])]};
175:     }catch{return {...result,warnings:['jgrants_fetch_failed']};}
176:   }
177:   if(!enabled(env.MHLW_CATALOG_SERVING_ENABLED))return {...result,warnings:['catalog_disabled']};
178:   if(!env.subsidy_ai_relations)return {...result,warnings:['database_not_configured']};
179:   try {
180:     const repo=new CatalogRepository(env.subsidy_ai_relations),release=await repo.activeId();result.catalogReleaseId=release;
181:     const all=await repo.db.prepare(`SELECT DISTINCT v.* FROM discovery_candidate_versions v JOIN discovery_release_items i ON i.version_id=v.id JOIN discovery_release_activations a ON a.release_id=i.release_id WHERE v.candidate_id=? ORDER BY v.created_at DESC`)
182:       .bind(input.candidate_id).all<VersionRow>();
183:     let versions=all.results;
184:     if(input.version_id)versions=versions.filter(v=>v.id===input.version_id);
185:     else if(input.event_date)versions=versions.filter(v=>{
186:       const p=payloadSchema.parse(JSON.parse(v.payload_json));return p.effectiveFrom&&p.effectiveFrom<=input.event_date!&&(!p.effectiveTo||p.effectiveTo>=input.event_date!)&&input.event_type&&p.eventType===input.event_type;
187:     });
188:     else versions=[]; // Exact version or an applicable event is required; don't silently use the latest year.
189:     if(!versions.length)return {...result,status:all.results.length?'version_selection_required':'not_indexed',missingFacts:all.results.length?['検索結果のversionId、または取組日と取組の種類を指定してください。']:[]};
190:     if(versions.length>1)return {...result,status:'version_selection_required',data:{versions:versions.map(v=>({versionId:v.id,...((p)=>({title:p.title,effectiveFrom:p.effectiveFrom,effectiveTo:p.effectiveTo,eventType:p.eventType}))(payloadSchema.parse(JSON.parse(v.payload_json)))}))},missingFacts:['適用する資料版を選択してください。']};
191:     const v=versions[0],p=payloadSchema.parse(JSON.parse(v.payload_json)),observation=await observe(repo,v,p,now);result.versionId=v.id;
192:     if(input.event_date&&(!p.effectiveFrom||p.effectiveFrom>input.event_date||p.effectiveTo&&p.effectiveTo<input.event_date||!input.event_type||input.event_type!==p.eventType))
193:       return {...result,status:'applicability_unconfirmed',missingFacts:['指定した取組日・種類への適用を、この版の根拠では確認できません。']};
194:     if(observation.detailStatus==='unavailable')return {...result,warnings:observation.sourceWarnings};
195:     const verifiedFacts=observation.detailStatus==='available'?p.facts.filter(f=>f.status==='reviewed'):[];
196:     const records=await repo.evidenceRecords(v.id);
197:     return {...result,status:observation.detailStatus,data:{...p,facts:verifiedFacts,...observation,
198:       sourceRecords:records.map(r=>({id:r.id,url:r.url,contentHash:r.content_hash,retrievedAt:iso(r.retrieved_at),lastVerifiedAt:iso(r.last_verified_at)})),
199:       attribution:'厚生労働省の公式情報を補助金AIが整理・加工。受給資格は未判定です。'},
200:       missingFacts:['取組日と事前手続きの状況を確認してください。',...(verifiedFacts.length?[]:['金額・期限・個別条件は公式資料で確認してください。'])],warnings:observation.sourceWarnings};
201:   }catch{return {...result,warnings:['catalog_database_unavailable']};}
202: }