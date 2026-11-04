1: import { CatalogError, DAY, digest, payloadSchema, sourceSchema, EXTRACTOR_VERSION,
2:   type CandidatePayload, type SourceConfig, type SourceRow, type RecordRow, type VersionRow, type DocumentJob } from './types';
3: import { permittedUrl } from '../officialDocuments/sourcePolicy';
4: 
5: export class CatalogRepository {
6:   constructor(readonly db: D1Database) {}
7:   async sources() { return (await this.db.prepare('SELECT * FROM discovery_sources ORDER BY id').all<SourceRow>()).results; }
8:   source(id: string) { return this.db.prepare('SELECT * FROM discovery_sources WHERE id=?').bind(id).first<SourceRow>(); }
9:   async register(raw: unknown, now: number) {
10:     const c = sourceSchema.parse(raw), json = JSON.stringify(c);
11:     if(new URL(c.url).hostname!=='www.mhlw.go.jp'||new URL(c.termsUrl).hostname!=='www.mhlw.go.jp')throw new CatalogError('unapproved_publisher');
12:     permittedUrl(c.url,c.policy,'pages');
13:     for(const url of c.dependencyPages)permittedUrl(url,c.policy,'pages');
14:     await this.db.prepare(`INSERT INTO discovery_sources(id,config_json,status,created_at) VALUES(?,?,'approved',?)
15:       ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,revision=revision+1,
16:       lease_token=NULL,lease_until=NULL,next_refresh_at=0 WHERE config_json<>excluded.config_json`).bind(c.id,json,now).run();
17:   }
18:   async control(id: string, action: 'refresh'|'pause'|'resume', now: number) {
19:     const sql = action === 'refresh' ? 'next_refresh_at=0' : `status='${action === 'pause'?'paused':'approved'}',next_refresh_at=0`;
20:     await this.db.prepare(`UPDATE discovery_sources SET ${sql},lease_token=NULL,lease_until=NULL WHERE id=?`).bind(id).run();
21:     // Refresh leaves registration trusted but invalidates in-flight writers.
22:     if (action === 'refresh') await this.db.prepare('UPDATE discovery_document_jobs SET next_refresh_at=? WHERE source_id=?').bind(now,id).run();
23:   }
24:   async claim(source: SourceRow, now: number) {
25:     const token=crypto.randomUUID(), runId=crypto.randomUUID();
26:     const row=await this.db.prepare(`UPDATE discovery_sources SET lease_token=?,lease_until=?,last_attempt_at=?
27:       WHERE id=? AND revision=? AND status='approved' AND (lease_until IS NULL OR lease_until<=?) RETURNING id`)
28:       .bind(token,now+240_000,now,source.id,source.revision,now).first();
29:     if (!row) return null;
30:     await this.db.prepare(`INSERT INTO discovery_fetch_runs(id,source_id,source_revision,started_at,status) VALUES(?,?,?,?,'running')`)
31:       .bind(runId,source.id,source.revision,now).run();
32:     return {token,runId};
33:   }
34:   async owns(source: SourceRow, token: string, now: number) {
35:     return !!await this.db.prepare(`SELECT id FROM discovery_sources WHERE id=? AND revision=? AND status='approved' AND lease_token=? AND lease_until>?`)
36:       .bind(source.id,source.revision,token,now).first();
37:   }
38:   latestRecord(sourceId: string,url: string) {
39:     return this.db.prepare('SELECT * FROM discovery_source_records WHERE source_id=? AND url=? ORDER BY last_verified_at DESC,retrieved_at DESC LIMIT 1')
40:       .bind(sourceId,url).first<RecordRow>();
41:   }
42:   async record(sourceId:string,response:{url:string;bytes:Uint8Array;headers:Headers},now:number,extractor=EXTRACTOR_VERSION) {
43:     const hash=await digest(response.bytes), id=await digest(`${sourceId}\n${response.url}\n${hash}`);
44:     await this.db.prepare(`INSERT INTO discovery_source_records(id,source_id,url,content_hash,mime_type,byte_length,retrieved_at,last_verified_at,etag,last_modified,extractor_version)
45:       VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_verified_at=excluded.last_verified_at,etag=excluded.etag,last_modified=excluded.last_modified`)
46:       .bind(id,sourceId,response.url,hash,response.headers.get('content-type')??'',response.bytes.length,now,now,
47:         response.headers.get('etag'),response.headers.get('last-modified'),extractor).run();
48:     return (await this.db.prepare('SELECT * FROM discovery_source_records WHERE id=?').bind(id).first<RecordRow>())!;
49:   }
50:   async touch(recordId:string,now:number) { await this.db.prepare('UPDATE discovery_source_records SET last_verified_at=? WHERE id=?').bind(now,recordId).run(); }
51:   async stage(source:SourceRow,runId:string,token:string,payload:CandidatePayload,now:number) {
52:     payload=payloadSchema.parse(payload);
53:     if (!await this.owns(source,token,now)) throw new CatalogError('superseded');
54:     const json=JSON.stringify(payload), hash=await digest(json), versionId=await digest(`${payload.candidateId}:${source.revision}:${hash}`);
55:     const statements=[
56:       this.db.prepare(`INSERT INTO discovery_candidates(id,source_id,course_key,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING`)
57:         .bind(payload.candidateId,source.id,payload.courseKey,now),
58:       this.db.prepare(`INSERT INTO discovery_candidate_versions(id,candidate_id,run_id,source_revision,payload_json,content_hash,review_status,created_at)
59:         SELECT ?,?,?,?,?,?,'pending',? WHERE EXISTS(SELECT 1 FROM discovery_sources WHERE id=? AND revision=? AND status='approved' AND lease_token=? AND lease_until>?)
60:         ON CONFLICT(id) DO NOTHING`).bind(versionId,payload.candidateId,runId,source.revision,json,hash,now,source.id,source.revision,token,now),
61:     ];
62:     for (const e of payload.evidence) statements.push(this.db.prepare(`INSERT INTO discovery_evidence(id,version_id,record_id,field_path,locator,excerpt,verification)
63:       SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM discovery_candidate_versions WHERE id=?) ON CONFLICT(id) DO NOTHING`)
64:       .bind(`${versionId}:${e.id}`,versionId,e.recordId,e.field,e.locator,e.excerpt,e.verification,versionId));
65:     for (const [kind,terms] of [['alias',payload.aliases],['purpose',payload.purposeTags]] as const)
66:       for (const term of terms) statements.push(this.db.prepare('INSERT OR IGNORE INTO discovery_aliases(candidate_id,term,kind) VALUES(?,?,?)').bind(payload.candidateId,term,kind));
67:     await this.db.batch(statements);
68:     return versionId;
69:   }
70:   async finish(source:SourceRow,claim:{token:string;runId:string},now:number,count:number,error?:string,retryAfterMs?:number,notModified=false) {
71:     const ok=await this.owns(source,claim.token,now);
72:     await this.db.batch([
73:       this.db.prepare('UPDATE discovery_fetch_runs SET status=?,finished_at=?,count=?,error_code=? WHERE id=?')
74:         .bind(!ok?'superseded':error?'failed':notModified?'not_modified':'succeeded',now,count,error??null,claim.runId),
75:       this.db.prepare(`UPDATE discovery_sources SET lease_token=NULL,lease_until=NULL,last_error=?,failures=?,
76:         last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,next_refresh_at=? WHERE id=? AND revision=? AND lease_token=?`)
77:         .bind(error??null,error?source.failures+1:0,error??null,now,
78:           now+(error?Math.max(retryAfterMs??0,Math.min(DAY,60_000*2**Math.min(source.failures,10))):JSON.parse(source.config_json).intervalHours*3_600_000),source.id,source.revision,claim.token),
79:     ]);
80:   }
81:   async enqueueDocuments(source:SourceRow,documents:{url:string;title:string}[],now:number) {
82:     for (const d of documents) {
83:       const id=await digest(`${source.id}:${source.revision}:${d.url}`);
84:       await this.db.prepare(`INSERT INTO discovery_document_jobs(id,source_id,source_revision,url,title,status,next_refresh_at,last_seen_at)
85:         VALUES(?,?,?,?,?,'pending',0,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,title=excluded.title`)
86:         .bind(id,source.id,source.revision,d.url,d.title,now).run();
87:     }
88:   }
89:   async jobs(sourceId?:string) {
90:     return (await this.db.prepare(`SELECT * FROM discovery_document_jobs ${sourceId?'WHERE source_id=?':''} ORDER BY next_refresh_at,id`)
91:       .bind(...(sourceId?[sourceId]:[])).all<DocumentJob>()).results;
92:   }
93:   job(id:string) { return this.db.prepare('SELECT * FROM discovery_document_jobs WHERE id=?').bind(id).first<DocumentJob>(); }
94:   async activeId() { return (await this.db.prepare('SELECT release_id FROM discovery_active_release WHERE singleton=1').first<{release_id:string|null}>())?.release_id??null; }
95:   version(id:string) { return this.db.prepare('SELECT * FROM discovery_candidate_versions WHERE id=?').bind(id).first<VersionRow>(); }
96:   async published(releaseId:string) {
97:     return (await this.db.prepare(`SELECT v.* FROM discovery_release_items i JOIN discovery_candidate_versions v ON v.id=i.version_id WHERE i.release_id=? ORDER BY i.candidate_id`)
98:       .bind(releaseId).all<VersionRow>()).results;
99:   }
100:   async evidenceRecords(versionId:string) {
101:     return (await this.db.prepare(`SELECT DISTINCT r.* FROM discovery_evidence e JOIN discovery_source_records r ON r.id=e.record_id WHERE e.version_id=?`)
102:       .bind(versionId).all<RecordRow>()).results;
103:   }
104:   async validate(versionId:string,note:string,now:number) {
105:     if (note.trim().length<10) throw new CatalogError('review_note_required');
106:     const v=await this.version(versionId); if(!v) throw new CatalogError('version_not_found');
107:     const p=payloadSchema.parse(JSON.parse(v.payload_json)), source=await this.source(p.sourceId);
108:     if (!source || source.status!=='approved' || source.revision!==v.source_revision) throw new CatalogError('source_revision_changed');
109:     const records=await this.evidenceRecords(v.id);
110:     if (records.length===0 || p.evidence.some(e=>!records.some(r=>r.id===e.recordId && r.source_id===p.sourceId))) throw new CatalogError('evidence_missing');
111:     for(const r of records){const latest=await this.latestRecord(p.sourceId,r.url);
112:       if(latest?.id!==r.id||r.last_verified_at+2*DAY<=now)throw new CatalogError('evidence_outdated');}
113:     const required=sourceSchema.parse(JSON.parse(source.config_json)).dependencyPages;
114:     if(required.some(url=>!records.some(r=>r.url===url)))throw new CatalogError('common_evidence_missing');
115:     if(new Set(p.evidence.map(e=>e.id)).size!==p.evidence.length)throw new CatalogError('duplicate_evidence');
116:     if(p.state!=='unknown'&&(!p.effectiveFrom||!p.evidence.some(e=>e.field==='applicability'&&e.verification==='reviewed')))throw new CatalogError('applicability_unreviewed');
117:     for(const fact of p.facts) {
118:       if(fact.status==='reviewed' && fact.evidenceIds.some(id=>!p.evidence.some(e=>e.id===id&&e.verification==='reviewed'))) throw new CatalogError('fact_evidence_unreviewed');
119:     }
120:     if (p.detailLevel==='conditions_reviewed' && (!p.facts.length || p.facts.some(f=>f.status!=='reviewed'))) throw new CatalogError('conditions_unreviewed');
121:     if(p.detailLevel==='conditions_reviewed') {
122:       if(!p.effectiveFrom||!p.evidence.some(e=>e.field==='applicability'&&e.verification==='reviewed'))throw new CatalogError('applicability_unreviewed');
123:       for(const d of p.documents.filter(d=>d.association==='common'))if(!records.some(r=>r.url===d.url))throw new CatalogError('common_evidence_missing');
124:       for(const f of p.facts)if(['amount','rate'].includes(f.kind)&&!f.unit?.trim())throw new CatalogError('unit_missing');
125:     }
126:     if (p.effectiveFrom && p.effectiveTo && p.effectiveFrom>p.effectiveTo) throw new CatalogError('invalid_effective_period');
127:     await this.db.prepare(`UPDATE discovery_candidate_versions SET review_status='validated',review_note=?,reviewed_at=? WHERE id=?`).bind(note,now,v.id).run();
128:     return {versionId,status:'validated'};
129:   }
130:   async publish(versionIds:string[],expectedRelease:string|null,note:string,now:number) {
131:     if(!versionIds.length || versionIds.length>2000 || new Set(versionIds).size!==versionIds.length || note.trim().length<10) throw new CatalogError('invalid_release');
132:     const versions=await Promise.all(versionIds.map(id=>this.version(id)));
133:     if(versions.some(v=>!v || v.review_status!=='validated')) throw new CatalogError('unvalidated_version');
134:     for(const v of versions)await this.validate(v!.id,note,now);
135:     if(new Set(versions.map(v=>v!.candidate_id)).size!==versions.length) throw new CatalogError('duplicate_candidate');
136:     const releaseId=crypto.randomUUID();
137:     const statements=[this.db.prepare('INSERT INTO discovery_releases(id,created_at,note) VALUES(?,?,?)').bind(releaseId,now,note)];
138:     for(const v of versions) statements.push(this.db.prepare(`INSERT INTO discovery_release_items(release_id,candidate_id,version_id)
139:       SELECT ?,v.candidate_id,v.id FROM discovery_candidate_versions v JOIN discovery_candidates c ON c.id=v.candidate_id JOIN discovery_sources s ON s.id=c.source_id
140:       WHERE v.id=? AND v.review_status='validated' AND s.status='approved' AND s.revision=v.source_revision`)
141:       .bind(releaseId,v!.id));
142:     statements.push(this.db.prepare(`UPDATE discovery_active_release SET release_id=? WHERE singleton=1 AND release_id IS ?
143:       AND (SELECT COUNT(*) FROM discovery_release_items WHERE release_id=?)=?`).bind(releaseId,expectedRelease,releaseId,versionIds.length));
144:     statements.push(this.db.prepare(`INSERT INTO discovery_release_activations(release_id,activated_at)
145:       SELECT ?,? WHERE EXISTS(SELECT 1 FROM discovery_active_release WHERE release_id=?)`).bind(releaseId,now,releaseId));
146:     const result=await this.db.batch(statements);
147:     if(result.at(-1)?.meta.changes!==1) throw new CatalogError('release_conflict');
148:     return {releaseId,count:versions.length};
149:   }
150:   async rollback(releaseId:string,expectedRelease:string|null) {
151:     const r=await this.db.prepare(`UPDATE discovery_active_release SET release_id=? WHERE singleton=1 AND release_id IS ?
152:       AND EXISTS(SELECT 1 FROM discovery_release_activations WHERE release_id=?)`).bind(releaseId,expectedRelease,releaseId).run();
153:     if(r.meta.changes!==1) throw new CatalogError('release_conflict');
154:   }
155:   async reviewPayload(versionId:string,raw:unknown,note:string,now:number) {
156:     const old=await this.version(versionId);if(!old)throw new CatalogError('version_not_found');
157:     const prior=payloadSchema.parse(JSON.parse(old.payload_json)),next=payloadSchema.parse(raw);
158:     if(next.candidateId!==prior.candidateId || next.sourceId!==prior.sourceId || next.courseKey!==prior.courseKey)throw new CatalogError('identity_changed');
159:     const source=await this.source(next.sourceId);if(!source)throw new CatalogError('source_missing');
160:     // Operator-authored reviews must reference observations already stored for this source.
161:     for(const e of next.evidence) {
162:       if(!await this.db.prepare('SELECT id FROM discovery_source_records WHERE id=? AND source_id=?').bind(e.recordId,source.id).first()) throw new CatalogError('evidence_missing');
163:     }
164:     const claim=await this.claim(source,now);if(!claim)throw new CatalogError('busy');
165:     try {
166:       const id=await this.stage(source,claim.runId,claim.token,next,now);
167:       const result=await this.validate(id,note,now);
168:       // A manual review does not assert a new successful network fetch.
169:       await this.db.prepare("UPDATE discovery_fetch_runs SET status='succeeded',finished_at=?,count=1 WHERE id=?").bind(now,claim.runId).run();
170:       return result;
171:     } finally {await this.db.prepare('UPDATE discovery_sources SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').bind(source.id,claim.token).run();}
172:   }
173:   async cleanup(now:number) {
174:     await this.db.prepare(`DELETE FROM discovery_fetch_runs WHERE finished_at<? AND id NOT IN (SELECT run_id FROM discovery_candidate_versions)`).bind(now-90*DAY).run();
175:     // Published records are retained; disposal after five years is an explicit archive operation.
176:   }
177: }