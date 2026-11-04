1: import { z } from "zod";
2: 
3: export const DOCUMENT_TYPES = ["guideline", "grant_rules", "application_form", "example", "faq", "checklist", "reference", "other"] as const;
4: export const STAGES = ["before_application", "application", "after_selection", "reporting", "general", "unknown"] as const;
5: export type DocumentType = typeof DOCUMENT_TYPES[number];
6: export type Stage = typeof STAGES[number];
7: export const DAY = 86_400_000;
8: export const EXTRACTOR_VERSION = "links-v1";
9: export const CLASSIFICATION_VERSION = "classification-v1";
10: export const PROMPT_VERSION = "purpose-v1";
11: export const iso = (ms: number) => new Date(ms).toISOString();
12: export const enabled = (value?: string) => value === "true";
13: export class DocumentError extends Error {
14:   constructor(readonly code: string, message = "資料情報を確認できませんでした。", readonly retryAfterMs?: number) { super(message); }
15: }
16: export async function hash(value: unknown): Promise<string> {
17:   return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))].map(x => x.toString(16).padStart(2, "0")).join("");
18: }
19: const ruleSchema = z.object({
20:   hostname: z.string().min(3).max(253),
21:   pathPrefix: z.string().startsWith("/").max(2048),
22:   queryKeys: z.array(z.string().max(80)).max(20).default([]),
23:   allowEmptyHexCacheBust: z.boolean().default(false),
24: }).strict();
25: export const policySchema = z.object({ pages: z.array(ruleSchema).min(1).max(20), files: z.array(ruleSchema).max(30) }).strict();
26: export type FetchPolicy = z.infer<typeof policySchema>;
27: export const extractorSchema = z.object({
28:   selector: z.string().min(1).max(500),
29:   linkSelector: z.string().min(1).max(500).default("a[href]"),
30:   contextSelector: z.string().min(1).max(500).default("li, tr, p, section"),
31:   requiredPageText: z.array(z.string().min(1).max(150)).min(1).max(10),
32:   confirmedContextText: z.array(z.string().min(1).max(150)).max(10).default([]),
33:   excludedContextText: z.array(z.string().min(1).max(150)).max(20).default([]),
34:   // Only for a manually reviewed, round-specific region. Never infer this from AI.
35:   associationBasis: z.enum(["official_heading", "explicit_common", "operator_reviewed", "unresolved"]),
36:   allowEmptyText: z.string().min(1).max(150).optional(),
37:   version: z.string().min(1).max(100),
38: }).strict();
39: export type ExtractorConfig = z.infer<typeof extractorSchema>;
40: export type Round = {
41:   id: number; program_series_key: string; canonical_name: string;
42:   fiscal_year: number; round_name: string; scope_key: string;
43:   jgrants_subsidy_id: string | null; acceptance_start: string | null; acceptance_end: string | null;
44: };
45: export const roundHash = (r: Round, workflow: string | null) => hash([r.program_series_key, r.canonical_name, r.fiscal_year, r.round_name, r.scope_key, r.jgrants_subsidy_id, r.acceptance_start, r.acceptance_end, workflow]);
46: export type Source = {
47:   id: string; subsidy_round_id: number; source_kind: "official_html" | "jgrants_detail";
48:   source_page_url: string; fetch_url: string; publisher_name: string; jgrants_workflow_id: string | null;
49:   registration_status: "pending" | "approved" | "paused" | "revoked";
50:   trust_evidence_url: string; trust_evidence_note: string; approved_at: string | null;
51:   approval_revision: number; round_binding_hash: string;
52:   fetch_policy_json: string; extractor_config_json: string; active_run_id: string | null;
53:   last_attempt_at: string | null; last_success_at: string | null;
54:   last_attempt_status: string | null; last_error_code: string | null;
55:   next_refresh_at: string; failure_count: number; lease_token: string | null; lease_until: string | null;
56: };
57: export type Classification = {
58:   documentType: DocumentType; displayTitle: string; purposeSummary: string | null; stage: Stage;
59:   classificationStatus: "rule_classified" | "ai_classified" | "operator_reviewed" | "unclassified" | "failed";
60:   classificationInputHash: string; classificationModel: string | null; classifiedAt: string | null;
61:   promptVersion: string; classificationVersion: string; evidence: string | null;
62: };
63: export type LinkResult = {
64:   linkStatus: "reachable" | "unverified" | "broken" | "blocked" | "not_direct" | "unsafe";
65:   linkLastCheckedAt: string | null; linkLastSuccessAt: string | null; linkFreshUntil: string | null;
66:   linkHttpStatus: number | null; linkCheckMethod: string | null; resolvedUrl: string | null; mimeType: string | null;
67: };
68: export type Candidate = {
69:   documentKey: string; resourceKind: "file_link" | "web_page" | "api_attachment";
70:   fileUrl: string | null; sourcePageUrl: string; webPageUrl: string | null; originalTitle: string; fileName: string | null;
71:   fileType: string; fileTypeBasis: string; contextExcerpt: string; sectionLocator: string;
72:   associationStatus: "confirmed" | "needs_review" | "mismatch";
73:   associationBasis: ExtractorConfig["associationBasis"]; typeHint: DocumentType | null;
74: };
75: export type Document = Candidate & Classification & LinkResult & {
76:   discoveredAt: string; sourceLastSeenAt: string; sourcePublishedAt: string | null; sourceUpdatedAt: string | null;
77: };
78: export type StoredDocument = { id: string; run_id: string; source_id: string; document_key: string; metadata_json: string; started_at: string };
79: export type Run = { id: string; source_id: string; status: string; started_at: string; etag: string | null; last_modified: string | null; page_body_hash: string | null; link_set_hash: string | null; approval_revision: number; extractor_version: string; round_binding_hash: string; warnings_json: string; extraction_complete: number };
80: export const inputSchema = z.object({
81:   subsidy_id: z.string().trim().min(1).max(18).regex(/^[A-Za-z0-9]+$/),
82:   round_id: z.number().int().positive().optional(),
83:   document_types: z.array(z.enum(DOCUMENT_TYPES)).max(8).optional(),
84:   include_reference: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(30),
85:   cursor: z.string().max(6000).nullable().optional(),
86: }).strict();
87: export type DocumentsInput = z.input<typeof inputSchema>;
88: export function refreshInterval(round: Round, now: number): number | null {
89:   const end = round.acceptance_end ? Date.parse(round.acceptance_end) : NaN;
90:   if (Number.isFinite(end)) {
91:     if (now > end + 90 * DAY) return null;
92:     if (now >= end) return 7 * DAY;
93:     if (end - now <= 3 * DAY) return DAY / 4;
94:   }
95:   return DAY;
96: }
97: export type DocumentEnv = {
98:   OFFICIAL_DOCUMENTS_ENABLED?: string; DOCUMENT_DISCOVERY_ENABLED?: string; DOCUMENT_CLASSIFICATION_ENABLED?: string;
99:   DOCUMENT_CLASSIFICATION_MODEL?: string; DOCUMENT_AI_DAILY_CALL_LIMIT?: string;
100:   DOCUMENT_AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
101:   PUBLIC_CACHE?: D1Database; subsidy_ai_relations?: D1Database;
102: };