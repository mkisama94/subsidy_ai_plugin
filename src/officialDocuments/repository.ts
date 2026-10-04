import { DAY, DocumentError, EXTRACTOR_VERSION, iso, type Document, type Round, type Run, type Source, type StoredDocument } from "./types";

const ROUND_SELECT = `SELECT r.id,p.program_series_key,p.canonical_name,r.fiscal_year,r.round_name,r.scope_key,
 r.jgrants_subsidy_id,r.acceptance_start,r.acceptance_end FROM subsidy_rounds r JOIN subsidy_programs p ON p.id=r.program_id`;
export class DocumentRepository {
  constructor(readonly db: D1Database) {}
  async rounds(subsidyId: string) { return (await this.db.prepare(`${ROUND_SELECT} WHERE r.jgrants_subsidy_id=? ORDER BY r.id`).bind(subsidyId).all<Round>()).results; }
  async round(id: number) { return this.db.prepare(`${ROUND_SELECT} WHERE r.id=?`).bind(id).first<Round>(); }
  async sources(roundId: number) { return (await this.db.prepare("SELECT * FROM official_document_sources WHERE subsidy_round_id=? ORDER BY id").bind(roundId).all<Source>()).results; }
  async source(id: string) { return this.db.prepare("SELECT * FROM official_document_sources WHERE id=?").bind(id).first<Source>(); }
  async run(id: string) { return this.db.prepare("SELECT * FROM document_discovery_runs WHERE id=?").bind(id).first<Run>(); }
  async documents(runId: string) {
    return (await this.db.prepare(`SELECT d.*,r.source_id,r.started_at FROM official_documents d JOIN document_discovery_runs r ON r.id=d.run_id WHERE d.run_id=? ORDER BY d.document_key`).bind(runId).all<StoredDocument>()).results;
  }
  async history(sourceId: string) {
    return (await this.db.prepare(`SELECT * FROM (SELECT d.*,r.source_id,r.started_at,
      ROW_NUMBER() OVER (PARTITION BY d.document_key ORDER BY r.started_at DESC,r.id DESC) AS n
      FROM official_documents d JOIN document_discovery_runs r ON r.id=d.run_id
      WHERE r.source_id=? AND r.status IN ('succeeded','not_modified')) WHERE n=1 LIMIT 1000`).bind(sourceId).all<StoredDocument>()).results;
  }
  async classification(key: string): Promise<Document | null> {
    const row = await this.db.prepare(`SELECT d.metadata_json FROM official_documents d JOIN document_discovery_runs r ON r.id=d.run_id
      WHERE d.classification_input_hash=? AND d.classification_status IN ('rule_classified','ai_classified','operator_reviewed')
      ORDER BY r.started_at DESC LIMIT 1`).bind(key).first<{metadata_json:string}>();
    return row ? JSON.parse(row.metadata_json) : null;
  }
  async due(now: number, limit = 5) {
    return (await this.db.prepare(`SELECT * FROM official_document_sources WHERE registration_status='approved'
      AND next_refresh_at<=? AND (lease_until IS NULL OR lease_until<=?)
      AND EXISTS(SELECT 1 FROM subsidy_rounds r WHERE r.id=subsidy_round_id AND (r.acceptance_end IS NULL OR julianday(r.acceptance_end) IS NULL OR julianday(r.acceptance_end)>=julianday(?)))
      ORDER BY next_refresh_at,id LIMIT ?`).bind(iso(now),iso(now),iso(now-90*DAY),limit).all<Source>()).results;
  }
  async claim(source: Source, now: number): Promise<{ runId: string; token: string } | null> {
    const token = crypto.randomUUID(), runId = crypto.randomUUID(), at = iso(now);
    const results = await this.db.batch([
      this.db.prepare(`UPDATE official_document_sources SET lease_token=?,lease_until=?,last_attempt_at=?,last_attempt_status='running',updated_at=?
        WHERE id=? AND registration_status='approved' AND approval_revision=? AND round_binding_hash=? AND (lease_until IS NULL OR lease_until<=?)`)
        .bind(token,iso(now+600_000),at,at,source.id,source.approval_revision,source.round_binding_hash,at),
      this.db.prepare(`UPDATE document_discovery_runs SET status='failed',finished_at=?,error_code='lease_expired'
        WHERE source_id=? AND status='running' AND EXISTS(SELECT 1 FROM official_document_sources WHERE id=? AND lease_token=?)`).bind(at,source.id,source.id,token),
      this.db.prepare(`INSERT INTO document_discovery_runs(id,source_id,status,started_at,extractor_version,approval_revision,round_binding_hash)
        SELECT ?,id,'running',?,?,approval_revision,round_binding_hash FROM official_document_sources WHERE id=? AND lease_token=?`)
        .bind(runId,at,EXTRACTOR_VERSION,source.id,token),
    ]);
    return results[0].meta.changes === 1 ? { runId, token } : null;
  }
  async reserveAi(runId: string, token: string, now: number, dailyLimit: number): Promise<boolean> {
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit <= 0) return false;
    const path = `$."${iso(now).slice(0,10)}".calls`;
    const r = await this.db.prepare(`UPDATE document_discovery_runs SET ai_call_count=ai_call_count+1,
      ai_usage_json=json_set(ai_usage_json,?,COALESCE(json_extract(ai_usage_json,?),0)+1)
      WHERE id=? AND status='running'
      AND EXISTS(SELECT 1 FROM official_document_sources s WHERE s.id=source_id AND s.lease_token=? AND s.lease_until>?)
      AND (SELECT COALESCE(SUM(COALESCE(json_extract(ai_usage_json,?),0)),0) FROM document_discovery_runs) < ?`)
      .bind(path,path,runId,token,iso(now),path,dailyLimit).run();
    return r.meta.changes === 1;
  }
  async stage(runId: string, round: Round, documents: Document[]) {
    for (const doc of documents) {
      const id = crypto.randomUUID();
      await this.db.batch([
        this.db.prepare(`INSERT INTO official_documents(id,run_id,document_key,classification_input_hash,classification_status,metadata_json) VALUES(?,?,?,?,?,?)`)
          .bind(id,runId,doc.documentKey,doc.classificationInputHash,doc.classificationStatus,JSON.stringify(doc)),
        this.db.prepare(`INSERT INTO subsidy_round_documents(subsidy_round_id,document_id,association_status,association_basis,round_label_original,
          scope_label_original,stage,context_excerpt,section_locator,association_checked_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .bind(round.id,id,doc.associationStatus,doc.associationBasis,round.round_name,round.scope_key,doc.stage,doc.contextExcerpt,doc.sectionLocator,
            doc.associationStatus === "confirmed" ? doc.sourceLastSeenAt : null),
      ]);
    }
  }
  async publish(source: Source, round: Round, runId: string, token: string, now: number, info: {
    status: "succeeded" | "not_modified"; observedAt: string; httpStatus: number; finalUrl: string;
    bodyHash: string | null; linkHash: string; etag: string | null; lastModified: string | null;
    count: number; published: number; unclassified: number; warnings: string[]; requests: number; nextRefresh: number;
  }): Promise<boolean> {
    const at=iso(now);
    const results = await this.db.batch([
      this.db.prepare(`UPDATE document_discovery_runs SET status=?,finished_at=?,source_observed_at=?,http_status=?,final_url=?,page_body_hash=?,
        link_set_hash=?,etag=?,last_modified=?,extraction_complete=1,candidate_count=?,published_count=?,unclassified_count=?,warnings_json=?,request_count=?
        WHERE id=? AND status='running'`).bind(info.status,at,info.observedAt,info.httpStatus,info.finalUrl,info.bodyHash,info.linkHash,info.etag,info.lastModified,
          info.count,info.published,info.unclassified,JSON.stringify(info.warnings),info.requests,runId),
      this.db.prepare(`UPDATE official_document_sources SET active_run_id=?,last_success_at=?,last_attempt_status=?,last_error_code=NULL,
        next_refresh_at=?,failure_count=0,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE id=? AND lease_token=? AND lease_until>? AND registration_status='approved' AND approval_revision=? AND round_binding_hash=?
        AND EXISTS(${ROUND_SELECT} WHERE r.id=official_document_sources.subsidy_round_id AND p.program_series_key=? AND p.canonical_name=?
          AND r.fiscal_year=? AND r.round_name=? AND r.scope_key=? AND r.jgrants_subsidy_id IS ? AND r.acceptance_start IS ? AND r.acceptance_end IS ?)`)
        .bind(runId,info.observedAt,info.status,iso(info.nextRefresh),at,source.id,token,at,source.approval_revision,source.round_binding_hash,
          round.program_series_key,round.canonical_name,round.fiscal_year,round.round_name,round.scope_key,round.jgrants_subsidy_id,round.acceptance_start,round.acceptance_end),
      this.db.prepare(`UPDATE document_discovery_runs SET status='superseded' WHERE id=? AND NOT EXISTS(SELECT 1 FROM official_document_sources WHERE active_run_id=?)`).bind(runId,runId),
    ]);
    return results[1].meta.changes === 1;
  }
  async fail(source: Source, runId: string, token: string, now: number, error: DocumentError, requests: number) {
    const partial = ["body_limit","candidate_limit","processing_limit","selector_missing","page_identity_changed","empty_after_nonempty"].includes(error.code);
    const delay = Math.max(error.retryAfterMs ?? 0, [3_600_000,21_600_000,DAY][Math.min(source.failure_count,2)]);
    await this.db.batch([
      this.db.prepare(`UPDATE document_discovery_runs SET status=?,finished_at=?,error_code=?,request_count=? WHERE id=? AND status='running'`)
        .bind(partial?"partial":"failed",iso(now),error.code,requests,runId),
      this.db.prepare(`UPDATE official_document_sources SET last_attempt_status=?,last_error_code=?,failure_count=failure_count+1,next_refresh_at=?,
        lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?`)
        .bind(partial?"partial":"failed",error.code,iso(now+delay),iso(now),source.id,token),
    ]);
  }
  async cleanup(now: number) {
    await this.db.prepare(`UPDATE document_discovery_runs SET status='failed',finished_at=?,error_code='lease_expired'
      WHERE status='running' AND started_at<? AND NOT EXISTS(SELECT 1 FROM official_document_sources s WHERE s.id=source_id AND s.lease_until>?)`)
      .bind(iso(now),iso(now-600_000),iso(now)).run();
    // Current snapshots (even stale ones), active jobs and their FK evidence survive cleanup.
    await this.db.prepare(`DELETE FROM document_discovery_runs WHERE id IN (SELECT id FROM document_discovery_runs
      WHERE status<>'running' AND started_at<? AND id NOT IN (SELECT active_run_id FROM official_document_sources WHERE active_run_id IS NOT NULL) LIMIT 100)`)
      .bind(iso(now-90*DAY)).run();
  }
}
