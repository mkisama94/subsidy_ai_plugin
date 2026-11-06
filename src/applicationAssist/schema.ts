import { z } from 'zod';

const id = z.string().min(1);
const date = z.iso.date();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const visibility = z.enum(['applicantOnly', 'vendorShareable', 'public']);
export const evidenceSchema = z.object({
  fieldId: id, caseId: id, companyId: id,
  value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
  unit: z.string().nullable(), periodStart: date.nullable(), periodEnd: date.nullable(), asOfDate: date.nullable(),
  state: z.enum(['unknown', 'extracted', 'verified', 'assumed', 'conflict', 'notApplicable']),
  sourceId: id, fileSha256: sha.nullable(), url: z.url().nullable(), page: z.number().int().positive().nullable(),
  originalLabel: z.string(), originalText: z.string(), bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  retrievedAt: z.iso.datetime().nullable(), sourceUpdatedAt: z.union([date, z.iso.datetime({ offset: true })]).nullable(),
  method: z.enum(['document', 'publicApi', 'applicant', 'calculated']),
  calculation: z.object({ inputFieldIds: z.array(id).min(1), formula: id, rounding: id, ruleVersion: id }).nullable(),
  reviewer: z.string().nullable(), reviewedAt: z.iso.datetime().nullable(), evidenceVersion: id,
  originalChecked: z.boolean(), applicantConfirmed: z.boolean(), visibility,
}).strict();
export const sourceSchema = z.object({
  sourceId: id, caseId: id, companyId: id, path: z.string().nullable(), sha256: sha.nullable(),
  url: z.url().nullable(), pageCount: z.number().int().positive().nullable(),
  kind: z.enum(['pdf', 'docx', 'publicApi', 'applicant', 'calculated']), visibility,
}).strict();
const reference = z.object({ url: z.url(), sha256: sha.nullable(), retrievedAt: z.iso.datetime().nullable(),
  revisedAt: date.nullable(), page: z.number().int().positive().nullable() });
const review = z.object({ reviewer: id, reviewedAt: z.iso.datetime(), revision: z.number().int().positive(), inputSnapshot: z.string() }).nullable();
export const caseSchema = z.object({
  schemaVersion: z.literal('1'), caseId: id, companyId: id,
  dataClass: z.enum(['private_actual', 'fictional_example', 'synthetic_test']),
  revision: z.number().int().positive(), applicationDate: date,
  scope: z.object({ year: z.number().int(), round: z.number().int(), frame: id,
    requestedGrantYen: z.number().int().nonnegative().nullable(), standardRate: z.boolean(), priorGrant: z.boolean().nullable() }),
  sources: z.array(sourceSchema), fields: z.array(evidenceSchema),
  // Dates are supplied from the applicable manual; no guessed fiscal-year algorithm.
  requiredPeriods: z.object({ latest: date.nullable(), productivity: date.nullable(), wages: date.nullable(), ruleVersion: id.nullable() }),
  rulePack: z.object({ version: id, year: z.number().int(), roundFrom: z.number().int(),
    effectiveFrom: date, verified: z.boolean(), testOnly: z.boolean(), references: z.array(reference),
    reviewer: z.string().nullable(),
    rateNumerator: z.number().int().positive(), rateDenominator: z.number().int().positive(),
    grantMinYen: z.number().int().nonnegative(), grantMaxExclusiveYen: z.number().int().positive(),
    maxMonths: z.number().int().positive(),
  }),
  fieldMap: z.object({ version: id, complete: z.boolean(), testOnly: z.boolean(),
    fields: z.array(z.object({ fieldId: id, screenId: id, order: z.number().int(), officialLabel: id,
      actor: z.enum(['applicant', 'vendor']), inputType: z.enum(['text', 'number', 'select', 'declaration']),
      requiredWhen: z.enum(['always', 'optional']), unit: z.string().nullable(), maxLength: z.number().int().positive().nullable(),
      rounding: z.enum(['exact', 'floor', 'ceil', 'halfAwayFromZero']).default('exact'),
      choices: z.array(z.object({ id, label: id })), reference, manualChecked: z.boolean(), screenCheckedAt: date.nullable(),
    })) }),
  product: z.object({ version: id, name: z.string(), plan: z.string().nullable(), toolNumber: z.string().nullable(),
    vendorNumber: z.string().nullable(), year: z.number().int(), frame: id, verified: z.boolean(),
    testOnly: z.boolean(), registrationReference: reference.nullable(), featureReferences: z.array(reference),
  }),
  requiredAttachmentIds: z.array(id),
  attachments: z.array(z.object({ attachmentId: id, sourceId: id, screenId: id, officialLabel: id,
    required: z.boolean(), periodEnd: date.nullable(), expectedPeriodEnd: date.nullable(),
    expiresAt: date.nullable(), format: id, maxBytes: z.number().int().positive(), bytes: z.number().int().nonnegative(),
    verified: z.boolean(), mappingVersion: id, visibility,
  })),
  apiChecks: z.array(z.object({ provider: z.enum(['nta', 'gbizinfo']), checkedAt: z.iso.datetime().nullable(), checkedOn: date.nullable().default(null),
    status: z.enum(['matched', 'ambiguous', 'notFound', 'failed', 'unverified']), code: z.string().nullable(),
    addressImageId: z.string().nullable(), addressImageVerified: z.boolean().default(false), notice: z.string(), sourceUrl: z.url(),
  })),
  review,
}).strict().superRefine((c, ctx) => {
  const seen = new Set<string>();
  for (const s of c.sources) {
    if (s.caseId !== c.caseId || s.companyId !== c.companyId || seen.has(s.sourceId))
      ctx.addIssue({ code: 'custom', message: 'Source identity mismatch or duplicate' });
    seen.add(s.sourceId);
  }
  const fieldIds = new Set<string>();
  for (const f of c.fields) {
    const s = c.sources.find(s => s.sourceId === f.sourceId);
    if (f.caseId !== c.caseId || f.companyId !== c.companyId || fieldIds.has(f.fieldId) || !s ||
        f.fileSha256 !== s.sha256 || (f.page !== null && (!s.pageCount || f.page > s.pageCount)))
      ctx.addIssue({ code: 'custom', message: 'Field evidence identity/hash/page mismatch' });
    if (f.method === 'calculated' && !f.calculation)
      ctx.addIssue({ code: 'custom', message: 'Calculation provenance required' });
    fieldIds.add(f.fieldId);
  }
  if (new Set(c.fieldMap.fields.map(f => f.fieldId)).size !== c.fieldMap.fields.length ||
      new Set(c.attachments.map(a => a.attachmentId)).size !== c.attachments.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate mapping/attachment' });
});
export type AssistCase = z.infer<typeof caseSchema>;
export type FieldEvidence = z.infer<typeof evidenceSchema>;
