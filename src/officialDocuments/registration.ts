import { z } from "zod";
import { extractorSchema, policySchema, roundHash, iso, type Round } from "./types";
import { permittedUrl } from "./sourcePolicy";

export const sourceRegistrationSchema=z.object({
  id:z.string().uuid(),sourceKind:z.enum(["official_html","jgrants_detail"]),
  program:z.object({seriesKey:z.string().min(1).max(150),name:z.string().min(1).max(300),institutionName:z.string().min(1).max(300)}).strict(),
  round:z.object({subsidyId:z.string().regex(/^[A-Za-z0-9]{1,18}$/),fiscalYear:z.number().int().min(2000).max(2200),
    name:z.string().min(1).max(100),scopeKey:z.string().min(1).max(100),acceptanceStart:z.string().datetime({offset:true}).nullable(),
    acceptanceEnd:z.string().datetime({offset:true}).nullable(),workflowId:z.string().max(100).nullable()}).strict(),
  sourcePageUrl:z.string().url(),fetchUrl:z.string().url(),publisherName:z.string().min(1).max(300),
  registrationStatus:z.enum(["pending","approved","paused","revoked"]),
  trustEvidenceUrl:z.string().url(),trustEvidenceNote:z.string().min(10).max(500),approvedAt:z.string().datetime({offset:true}).nullable(),
  policy:policySchema,extractor:extractorSchema,
}).strict();
export const registrationFileSchema=z.object({schemaVersion:z.literal(1),sources:z.array(sourceRegistrationSchema).max(100)}).strict();
const sql=(value:unknown):string=>value===null?"NULL":typeof value==="number"?String(value):`'${String(value).replaceAll("'","''")}'`;
export async function registrationSql(raw:unknown,now=Date.now()):Promise<string> {
  const file=registrationFileSchema.parse(raw),statements:string[]=[];
  const ids=new Set<string>();
  for(const s of file.sources) {
    if(ids.has(s.id))throw new Error("duplicate source ID"); ids.add(s.id);
    permittedUrl(s.sourcePageUrl,s.policy,"pages");permittedUrl(s.fetchUrl,s.policy,"pages");
    if(s.registrationStatus==="approved"&&!s.approvedAt)throw new Error("approved source needs approvedAt");
    if(new URL(s.trustEvidenceUrl).protocol!=="https:" || s.approvedAt&&Date.parse(s.approvedAt)>now)throw new Error("invalid approval evidence");
    if(s.sourceKind==="jgrants_detail"&&s.fetchUrl!==`https://api.jgrants-portal.go.jp/exp/v2/public/subsidies/id/${s.round.subsidyId}`)throw new Error("invalid jGrants endpoint");
    const round:Round={id:0,program_series_key:s.program.seriesKey,canonical_name:s.program.name,fiscal_year:s.round.fiscalYear,round_name:s.round.name,scope_key:s.round.scopeKey,
      jgrants_subsidy_id:s.round.subsidyId,acceptance_start:s.round.acceptanceStart,acceptance_end:s.round.acceptanceEnd};
    const binding=await roundHash(round,s.round.workflowId),at=iso(now);
    statements.push(`INSERT INTO subsidy_programs(program_series_key,canonical_name,institution_name) VALUES(${sql(s.program.seriesKey)},${sql(s.program.name)},${sql(s.program.institutionName)}) ON CONFLICT(program_series_key) DO NOTHING;`);
    statements.push(`INSERT INTO subsidy_rounds(program_id,jgrants_subsidy_id,fiscal_year,round_name,scope_key,acceptance_start,acceptance_end,last_checked_at)
      SELECT id,${sql(s.round.subsidyId)},${s.round.fiscalYear},${sql(s.round.name)},${sql(s.round.scopeKey)},${sql(s.round.acceptanceStart)},${sql(s.round.acceptanceEnd)},${sql(at)}
      FROM subsidy_programs WHERE program_series_key=${sql(s.program.seriesKey)} AND canonical_name=${sql(s.program.name)}
      ON CONFLICT(program_id,fiscal_year,round_name,scope_key) DO NOTHING;`);
    const fields={source_kind:s.sourceKind,source_page_url:s.sourcePageUrl,fetch_url:s.fetchUrl,publisher_name:s.publisherName,jgrants_workflow_id:s.round.workflowId,
      registration_status:s.registrationStatus,trust_evidence_url:s.trustEvidenceUrl,trust_evidence_note:s.trustEvidenceNote,approved_at:s.approvedAt,
      round_binding_hash:binding,fetch_policy_json:JSON.stringify(s.policy),extractor_config_json:JSON.stringify(s.extractor)};
    statements.push(`INSERT INTO official_document_sources(id,subsidy_round_id,${Object.keys(fields).join(",")},approval_revision,next_refresh_at,created_at,updated_at)
      SELECT ${sql(s.id)},r.id,${Object.values(fields).map(sql).join(",")},1,${sql(at)},${sql(at)},${sql(at)}
      FROM subsidy_rounds r JOIN subsidy_programs p ON p.id=r.program_id WHERE p.program_series_key=${sql(s.program.seriesKey)} AND p.canonical_name=${sql(s.program.name)}
      AND r.jgrants_subsidy_id=${sql(s.round.subsidyId)} AND r.fiscal_year=${s.round.fiscalYear} AND r.round_name=${sql(s.round.name)} AND r.scope_key=${sql(s.round.scopeKey)}
      AND r.acceptance_start IS ${sql(s.round.acceptanceStart)} AND r.acceptance_end IS ${sql(s.round.acceptanceEnd)}
      ON CONFLICT(id) DO UPDATE SET ${Object.keys(fields).map(f=>`${f}=excluded.${f}`).join(",")},approval_revision=official_document_sources.approval_revision+1,
      lease_token=NULL,lease_until=NULL,next_refresh_at=excluded.next_refresh_at,updated_at=excluded.updated_at,last_error_code=NULL
      WHERE official_document_sources.subsidy_round_id=excluded.subsidy_round_id;`);
  }
  return statements.join("\n");
}
