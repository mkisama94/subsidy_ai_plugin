import { CatalogError, DAY, digest, payloadSchema, sourceSchema, EXTRACTOR_VERSION,
  type CandidatePayload, type SourceConfig, type SourceRow, type RecordRow, type VersionRow, type DocumentJob } from './types';
import { permittedUrl } from '../officialDocuments/sourcePolicy';

export class CatalogRepository {
  constructor(readonly db: D1Database) {}
  async sources() { return (await this.db.prepare('SELECT * FROM discovery_sources ORDER BY id').all<SourceRow>()).results; }
  source(id: string) { return this.db.prepare('SELECT * FROM discovery_sources WHERE id=?').bind(id).first<SourceRow>(); }
  async register(raw: unknown, now: number) {
    const c = sourceSchema.parse(raw), json = JSON.stringify(c);
    if(new URL(c.url).hostname!=='www.mhlw.go.jp'||new URL(c.termsUrl).hostname!=='www.mhlw.go.jp')throw new CatalogError('unapproved_publisher');
    permittedUrl(c.url,c.policy,'pages');
    for(const url of c.dependencyPages)permittedUrl(url,c.policy,'pages');
    await this.db.prepare(`INSERT INTO discovery_sources(id,config_json,status,created_at) VALUES(?,?,'approved',?)
      ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,revision=revision+1,
      lease_token=NULL,lease_until=NULL,next_refresh_at=0 WHERE config_json<>excluded.config_json`).bind(c.id,json,now).run();
  }
  async control(id: string, action: 'refresh'|'pause'|'resume', now: number) {
    const sql = action === 'refresh' ? 'next_refresh_at=0' : `status='${action === 'pause'?'paused':'approved'}',next_refresh_at=0`;
    await this.db.prepare(`UPDATE discovery_sources SET ${sql},lease_token=NULL,lease_until=NULL WHERE id=?`).bind(id).run();
    // Refresh leaves registration trusted but invalidates in-flight writers.
    if (action === 'refresh') await this.db.prepare('UPDATE discovery_document_jobs SET next_refresh_at=? WHERE source_id=?').bind(now,id).run();
  }
  async claim(source: SourceRow, now: number) {
    const token=crypto.randomUUID(), runId=crypto.randomUUID();
    const row=await this.db.prepare(`UPDATE discovery_sources SET lease_token=?,lease_until=?,last_attempt_at=?
      WHERE id=? AND revision=? AND status='approved' AND (lease_until IS NULL OR lease_until<=?) RETURNING id`)
      .bind(token,now+240_000,now,source.id,source.revision,now).first();
    if (!row) return null;
    await this.db.prepare(`INSERT INTO discovery_fetch_runs(id,source_id,source_revision,started_at,status) VALUES(?,?,?,?,'running')`)
      .bind(runId,source.id,source.revision,now).run();
    return {token,runId};
  }
  async owns(source: SourceRow, token: string, now: number) {
    return !!await this.db.prepare(`SELECT id FROM discovery_sources WHERE id=? AND revision=? AND status='approved' AND lease_token=? AND lease_until>?`)
      .bind(source.id,source.revision,token,now).first();
  }
  latestRecord(sourceId: string,url: string) {
    return this.db.prepare('SELECT * FROM discovery_source_records WHERE source_id=? AND url=? ORDER BY last_verified_at DESC,retrieved_at DESC LIMIT 1')
      .bind(sourceId,url).first<RecordRow>();
  }
  async record(sourceId:string,response:{url:string;bytes:Uint8Array;headers:Headers},now:number,extractor=EXTRACTOR_VERSION) {
    const hash=await digest(response.bytes), id=await digest(`${sourceId}\n${response.url}\n${hash}`);
    await this.db.prepare(`INSERT INTO discovery_source_records(id,source_id,url,content_hash,mime_type,byte_length,retrieved_at,last_verified_at,etag,last_modified,extractor_version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_verified_at=excluded.last_verified_at,etag=excluded.etag,last_modified=excluded.last_modified`)
      .bind(id,sourceId,response.url,hash,response.headers.get('content-type')??'',response.bytes.length,now,now,
        response.headers.get('etag'),response.headers.get('last-modified'),extractor).run();
    return (await this.db.prepare('SELECT * FROM discovery_source_records WHERE id=?').bind(id).first<RecordRow>())!;
  }
  async touch(recordId:string,now:number) { await this.db.prepare('UPDATE discovery_source_records SET last_verified_at=? WHERE id=?').bind(now,recordId).run(); }
  async stage(source:SourceRow,runId:string,token:string,payload:CandidatePayload,now:number) {
    payload=payloadSchema.parse(payload);
    if (!await this.owns(source,token,now)) throw new CatalogError('superseded');
    const json=JSON.stringify(payload), hash=await digest(json), versionId=await digest(`${payload.candidateId}:${source.revision}:${hash}`);
    const statements=[
      this.db.prepare(`INSERT INTO discovery_candidates(id,source_id,course_key,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING`)
        .bind(payload.candidateId,source.id,payload.courseKey,now),
      this.db.prepare(`INSERT INTO discovery_candidate_versions(id,candidate_id,run_id,source_revision,payload_json,content_hash,review_status,created_at)
        SELECT ?,?,?,?,?,?,'pending',? WHERE EXISTS(SELECT 1 FROM discovery_sources WHERE id=? AND revision=? AND status='approved' AND lease_token=? AND lease_until>?)
        ON CONFLICT(id) DO NOTHING`).bind(versionId,payload.candidateId,runId,source.revision,json,hash,now,source.id,source.revision,token,now),
    ];
    for (const e of payload.evidence) statements.push(this.db.prepare(`INSERT INTO discovery_evidence(id,version_id,record_id,field_path,locator,excerpt,verification)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM discovery_candidate_versions WHERE id=?) ON CONFLICT(id) DO NOTHING`)
      .bind(`${versionId}:${e.id}`,versionId,e.recordId,e.field,e.locator,e.excerpt,e.verification,versionId));
    for (const [kind,terms] of [['alias',payload.aliases],['purpose',payload.purposeTags]] as const)
      for (const term of terms) statements.push(this.db.prepare('INSERT OR IGNORE INTO discovery_aliases(candidate_id,term,kind) VALUES(?,?,?)').bind(payload.candidateId,term,kind));
    await this.db.batch(statements);
    return versionId;
  }
  async finish(source:SourceRow,claim:{token:string;runId:string},now:number,count:number,error?:string,retryAfterMs?:number,notModified=false) {
    const ok=await this.owns(source,claim.token,now);
    await this.db.batch([
      this.db.prepare('UPDATE discovery_fetch_runs SET status=?,finished_at=?,count=?,error_code=? WHERE id=?')
        .bind(!ok?'superseded':error?'failed':notModified?'not_modified':'succeeded',now,count,error??null,claim.runId),
      this.db.prepare(`UPDATE discovery_sources SET lease_token=NULL,lease_until=NULL,last_error=?,failures=?,
        last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,next_refresh_at=? WHERE id=? AND revision=? AND lease_token=?`)
        .bind(error??null,error?source.failures+1:0,error??null,now,
          now+(error?Math.max(retryAfterMs??0,Math.min(DAY,60_000*2**Math.min(source.failures,10))):JSON.parse(source.config_json).intervalHours*3_600_000),source.id,source.revision,claim.token),
    ]);
  }
  async enqueueDocuments(source:SourceRow,documents:{url:string;title:string}[],now:number) {
    for (const d of documents) {
      const id=await digest(`${source.id}:${source.revision}:${d.url}`);
      await this.db.prepare(`INSERT INTO discovery_document_jobs(id,source_id,source_revision,url,title,status,next_refresh_at,last_seen_at)
        VALUES(?,?,?,?,?,'pending',0,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,title=excluded.title`)
        .bind(id,source.id,source.revision,d.url,d.title,now).run();
    }
  }
  async jobs(sourceId?:string) {
    return (await this.db.prepare(`SELECT * FROM discovery_document_jobs ${sourceId?'WHERE source_id=?':''} ORDER BY next_refresh_at,id`)
      .bind(...(sourceId?[sourceId]:[])).all<DocumentJob>()).results;
  }
  job(id:string) { return this.db.prepare('SELECT * FROM discovery_document_jobs WHERE id=?').bind(id).first<DocumentJob>(); }
  async activeId() { return (await this.db.prepare('SELECT release_id FROM discovery_active_release WHERE singleton=1').first<{release_id:string|null}>())?.release_id??null; }
  version(id:string) { return this.db.prepare('SELECT * FROM discovery_candidate_versions WHERE id=?').bind(id).first<VersionRow>(); }
  async published(releaseId:string) {
    return (await this.db.prepare(`SELECT v.* FROM discovery_release_items i JOIN discovery_candidate_versions v ON v.id=i.version_id WHERE i.release_id=? ORDER BY i.candidate_id`)
      .bind(releaseId).all<VersionRow>()).results;
  }
  async evidenceRecords(versionId:string) {
    return (await this.db.prepare(`SELECT DISTINCT r.* FROM discovery_evidence e JOIN discovery_source_records r ON r.id=e.record_id WHERE e.version_id=?`)
      .bind(versionId).all<RecordRow>()).results;
  }
  async validate(versionId:string,note:string,now:number) {
    if (note.trim().length<10) throw new CatalogError('review_note_required');
    const v=await this.version(versionId); if(!v) throw new CatalogError('version_not_found');
    const p=payloadSchema.parse(JSON.parse(v.payload_json)), source=await this.source(p.sourceId);
    if (!source || source.status!=='approved' || source.revision!==v.source_revision) throw new CatalogError('source_revision_changed');
    const records=await this.evidenceRecords(v.id);
    if (records.length===0 || p.evidence.some(e=>!records.some(r=>r.id===e.recordId && r.source_id===p.sourceId))) throw new CatalogError('evidence_missing');
    for(const r of records){const latest=await this.latestRecord(p.sourceId,r.url);
      if(latest?.id!==r.id||r.last_verified_at+2*DAY<=now)throw new CatalogError('evidence_outdated');}
    const required=sourceSchema.parse(JSON.parse(source.config_json)).dependencyPages;
    if(required.some(url=>!records.some(r=>r.url===url)))throw new CatalogError('common_evidence_missing');
    if(new Set(p.evidence.map(e=>e.id)).size!==p.evidence.length)throw new CatalogError('duplicate_evidence');
    if(p.state!=='unknown'&&(!p.effectiveFrom||!p.evidence.some(e=>e.field==='applicability'&&e.verification==='reviewed')))throw new CatalogError('applicability_unreviewed');
    for(const fact of p.facts) {
      if(fact.status==='reviewed' && fact.evidenceIds.some(id=>!p.evidence.some(e=>e.id===id&&e.verification==='reviewed'))) throw new CatalogError('fact_evidence_unreviewed');
    }
    if (p.detailLevel==='conditions_reviewed' && (!p.facts.length || p.facts.some(f=>f.status!=='reviewed'))) throw new CatalogError('conditions_unreviewed');
    if(p.detailLevel==='conditions_reviewed') {
      if(!p.effectiveFrom||!p.evidence.some(e=>e.field==='applicability'&&e.verification==='reviewed'))throw new CatalogError('applicability_unreviewed');
      for(const d of p.documents.filter(d=>d.association==='common'))if(!records.some(r=>r.url===d.url))throw new CatalogError('common_evidence_missing');
      for(const f of p.facts)if(['amount','rate'].includes(f.kind)&&!f.unit?.trim())throw new CatalogError('unit_missing');
    }
    if (p.effectiveFrom && p.effectiveTo && p.effectiveFrom>p.effectiveTo) throw new CatalogError('invalid_effective_period');
    await this.db.prepare(`UPDATE discovery_candidate_versions SET review_status='validated',review_note=?,reviewed_at=? WHERE id=?`).bind(note,now,v.id).run();
    return {versionId,status:'validated'};
  }
  async publish(versionIds:string[],expectedRelease:string|null,note:string,now:number) {
    if(!versionIds.length || versionIds.length>2000 || new Set(versionIds).size!==versionIds.length || note.trim().length<10) throw new CatalogError('invalid_release');
    const versions=await Promise.all(versionIds.map(id=>this.version(id)));
    if(versions.some(v=>!v || v.review_status!=='validated')) throw new CatalogError('unvalidated_version');
    for(const v of versions)await this.validate(v!.id,note,now);
    if(new Set(versions.map(v=>v!.candidate_id)).size!==versions.length) throw new CatalogError('duplicate_candidate');
    const releaseId=crypto.randomUUID();
    const statements=[this.db.prepare('INSERT INTO discovery_releases(id,created_at,note) VALUES(?,?,?)').bind(releaseId,now,note)];
    for(const v of versions) statements.push(this.db.prepare(`INSERT INTO discovery_release_items(release_id,candidate_id,version_id)
      SELECT ?,v.candidate_id,v.id FROM discovery_candidate_versions v JOIN discovery_candidates c ON c.id=v.candidate_id JOIN discovery_sources s ON s.id=c.source_id
      WHERE v.id=? AND v.review_status='validated' AND s.status='approved' AND s.revision=v.source_revision`)
      .bind(releaseId,v!.id));
    statements.push(this.db.prepare(`UPDATE discovery_active_release SET release_id=? WHERE singleton=1 AND release_id IS ?
      AND (SELECT COUNT(*) FROM discovery_release_items WHERE release_id=?)=?`).bind(releaseId,expectedRelease,releaseId,versionIds.length));
    statements.push(this.db.prepare(`INSERT INTO discovery_release_activations(release_id,activated_at)
      SELECT ?,? WHERE EXISTS(SELECT 1 FROM discovery_active_release WHERE release_id=?)`).bind(releaseId,now,releaseId));
    const result=await this.db.batch(statements);
    if(result.at(-1)?.meta.changes!==1) throw new CatalogError('release_conflict');
    return {releaseId,count:versions.length};
  }
  async rollback(releaseId:string,expectedRelease:string|null) {
    const r=await this.db.prepare(`UPDATE discovery_active_release SET release_id=? WHERE singleton=1 AND release_id IS ?
      AND EXISTS(SELECT 1 FROM discovery_release_activations WHERE release_id=?)`).bind(releaseId,expectedRelease,releaseId).run();
    if(r.meta.changes!==1) throw new CatalogError('release_conflict');
  }
  async reviewPayload(versionId:string,raw:unknown,note:string,now:number) {
    const old=await this.version(versionId);if(!old)throw new CatalogError('version_not_found');
    const prior=payloadSchema.parse(JSON.parse(old.payload_json)),next=payloadSchema.parse(raw);
    if(next.candidateId!==prior.candidateId || next.sourceId!==prior.sourceId || next.courseKey!==prior.courseKey)throw new CatalogError('identity_changed');
    const source=await this.source(next.sourceId);if(!source)throw new CatalogError('source_missing');
    // Operator-authored reviews must reference observations already stored for this source.
    for(const e of next.evidence) {
      if(!await this.db.prepare('SELECT id FROM discovery_source_records WHERE id=? AND source_id=?').bind(e.recordId,source.id).first()) throw new CatalogError('evidence_missing');
    }
    const claim=await this.claim(source,now);if(!claim)throw new CatalogError('busy');
    try {
      const id=await this.stage(source,claim.runId,claim.token,next,now);
      const result=await this.validate(id,note,now);
      // A manual review does not assert a new successful network fetch.
      await this.db.prepare("UPDATE discovery_fetch_runs SET status='succeeded',finished_at=?,count=1 WHERE id=?").bind(now,claim.runId).run();
      return result;
    } finally {await this.db.prepare('UPDATE discovery_sources SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').bind(source.id,claim.token).run();}
  }
  async cleanup(now:number) {
    await this.db.prepare(`DELETE FROM discovery_fetch_runs WHERE finished_at<? AND id NOT IN (SELECT run_id FROM discovery_candidate_versions)`).bind(now-90*DAY).run();
    // Published records are retained; disposal after five years is an explicit archive operation.
  }
}
