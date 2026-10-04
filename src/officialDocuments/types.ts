import { z } from "zod";

export const DOCUMENT_TYPES = ["guideline", "grant_rules", "application_form", "example", "faq", "checklist", "reference", "other"] as const;
export const STAGES = ["before_application", "application", "after_selection", "reporting", "general", "unknown"] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];
export type Stage = typeof STAGES[number];
export const DAY = 86_400_000;
export const EXTRACTOR_VERSION = "links-v1";
export const CLASSIFICATION_VERSION = "classification-v1";
export const PROMPT_VERSION = "purpose-v1";
export const iso = (ms: number) => new Date(ms).toISOString();
export const enabled = (value?: string) => value === "true";
export class DocumentError extends Error {
  constructor(readonly code: string, message = "資料情報を確認できませんでした。", readonly retryAfterMs?: number) { super(message); }
}
export async function hash(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))].map(x => x.toString(16).padStart(2, "0")).join("");
}
const ruleSchema = z.object({
  hostname: z.string().min(3).max(253),
  pathPrefix: z.string().startsWith("/").max(2048),
  queryKeys: z.array(z.string().max(80)).max(20).default([]),
  allowEmptyHexCacheBust: z.boolean().default(false),
}).strict();
export const policySchema = z.object({ pages: z.array(ruleSchema).min(1).max(20), files: z.array(ruleSchema).max(30) }).strict();
export type FetchPolicy = z.infer<typeof policySchema>;
export const extractorSchema = z.object({
  selector: z.string().min(1).max(500),
  linkSelector: z.string().min(1).max(500).default("a[href]"),
  contextSelector: z.string().min(1).max(500).default("li, tr, p, section"),
  requiredPageText: z.array(z.string().min(1).max(150)).min(1).max(10),
  confirmedContextText: z.array(z.string().min(1).max(150)).max(10).default([]),
  excludedContextText: z.array(z.string().min(1).max(150)).max(20).default([]),
  // Only for a manually reviewed, round-specific region. Never infer this from AI.
  associationBasis: z.enum(["official_heading", "explicit_common", "operator_reviewed", "unresolved"]),
  allowEmptyText: z.string().min(1).max(150).optional(),
  version: z.string().min(1).max(100),
}).strict();
export type ExtractorConfig = z.infer<typeof extractorSchema>;
export type Round = {
  id: number; program_series_key: string; canonical_name: string;
  fiscal_year: number; round_name: string; scope_key: string;
  jgrants_subsidy_id: string | null; acceptance_start: string | null; acceptance_end: string | null;
};
export const roundHash = (r: Round, workflow: string | null) => hash([r.program_series_key, r.canonical_name, r.fiscal_year, r.round_name, r.scope_key, r.jgrants_subsidy_id, r.acceptance_start, r.acceptance_end, workflow]);
export type Source = {
  id: string; subsidy_round_id: number; source_kind: "official_html" | "jgrants_detail";
  source_page_url: string; fetch_url: string; publisher_name: string; jgrants_workflow_id: string | null;
  registration_status: "pending" | "approved" | "paused" | "revoked";
  trust_evidence_url: string; trust_evidence_note: string; approved_at: string | null;
  approval_revision: number; round_binding_hash: string;
  fetch_policy_json: string; extractor_config_json: string; active_run_id: string | null;
  last_attempt_at: string | null; last_success_at: string | null;
  last_attempt_status: string | null; last_error_code: string | null;
  next_refresh_at: string; failure_count: number; lease_token: string | null; lease_until: string | null;
};
export type Classification = {
  documentType: DocumentType; displayTitle: string; purposeSummary: string | null; stage: Stage;
  classificationStatus: "rule_classified" | "ai_classified" | "operator_reviewed" | "unclassified" | "failed";
  classificationInputHash: string; classificationModel: string | null; classifiedAt: string | null;
  promptVersion: string; classificationVersion: string; evidence: string | null;
};
export type LinkResult = {
  linkStatus: "reachable" | "unverified" | "broken" | "blocked" | "not_direct" | "unsafe";
  linkLastCheckedAt: string | null; linkLastSuccessAt: string | null; linkFreshUntil: string | null;
  linkHttpStatus: number | null; linkCheckMethod: string | null; resolvedUrl: string | null; mimeType: string | null;
};
export type Candidate = {
  documentKey: string; resourceKind: "file_link" | "web_page" | "api_attachment";
  fileUrl: string | null; sourcePageUrl: string; webPageUrl: string | null; originalTitle: string; fileName: string | null;
  fileType: string; fileTypeBasis: string; contextExcerpt: string; sectionLocator: string;
  associationStatus: "confirmed" | "needs_review" | "mismatch";
  associationBasis: ExtractorConfig["associationBasis"]; typeHint: DocumentType | null;
};
export type Document = Candidate & Classification & LinkResult & {
  discoveredAt: string; sourceLastSeenAt: string; sourcePublishedAt: string | null; sourceUpdatedAt: string | null;
};
export type StoredDocument = { id: string; run_id: string; source_id: string; document_key: string; metadata_json: string; started_at: string };
export type Run = { id: string; source_id: string; status: string; started_at: string; etag: string | null; last_modified: string | null; page_body_hash: string | null; link_set_hash: string | null; approval_revision: number; extractor_version: string; round_binding_hash: string; warnings_json: string; extraction_complete: number };
export const inputSchema = z.object({
  subsidy_id: z.string().trim().min(1).max(18).regex(/^[A-Za-z0-9]+$/),
  round_id: z.number().int().positive().optional(),
  document_types: z.array(z.enum(DOCUMENT_TYPES)).max(8).optional(),
  include_reference: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(30),
  cursor: z.string().max(6000).nullable().optional(),
}).strict();
export type DocumentsInput = z.input<typeof inputSchema>;
export function refreshInterval(round: Round, now: number): number | null {
  const end = round.acceptance_end ? Date.parse(round.acceptance_end) : NaN;
  if (Number.isFinite(end)) {
    if (now > end + 90 * DAY) return null;
    if (now >= end) return 7 * DAY;
    if (end - now <= 3 * DAY) return DAY / 4;
  }
  return DAY;
}
export type DocumentEnv = {
  OFFICIAL_DOCUMENTS_ENABLED?: string; DOCUMENT_DISCOVERY_ENABLED?: string; DOCUMENT_CLASSIFICATION_ENABLED?: string;
  DOCUMENT_CLASSIFICATION_MODEL?: string; DOCUMENT_AI_DAILY_CALL_LIMIT?: string;
  DOCUMENT_AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  PUBLIC_CACHE?: D1Database; subsidy_ai_relations?: D1Database;
};
