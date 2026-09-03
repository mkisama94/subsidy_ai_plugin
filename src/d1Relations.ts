export type CompanyInput = {
  corporateNumber?: string | null;
  edinetCode?: string | null;
  securitiesCode?: string | null;
  name: string;
  normalizedName?: string;
  sourceUpdatedAt?: string | null;
};

export type CompanyRecord = {
  id: number;
  corporateNumber: string | null;
  edinetCode: string | null;
  securitiesCode: string | null;
  name: string;
  normalizedName: string;
  sourceUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EdinetDocumentFetchStatus =
  | "discovered"
  | "fetched"
  | "parsed"
  | "failed";

export type EdinetDocumentInput = {
  documentId: string;
  filerCompanyId?: number | null;
  filerName: string;
  filerCorporateNumber?: string | null;
  filerEdinetCode?: string | null;
  documentTypeCode?: string | null;
  documentType?: string | null;
  submittedAt: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  sourceReference: string;
  fetchStatus?: EdinetDocumentFetchStatus;
  fetchedAt?: string | null;
  parsedAt?: string | null;
  errorMessage?: string | null;
};

export type EdinetDocumentRecord = {
  documentId: string;
  filerCompanyId: number | null;
  filerName: string;
  filerCorporateNumber: string | null;
  filerEdinetCode: string | null;
  documentTypeCode: string | null;
  documentType: string | null;
  submittedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  sourceReference: string;
  fetchStatus: EdinetDocumentFetchStatus;
  fetchedAt: string | null;
  parsedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanyRelationType =
  | "parent"
  | "subsidiary"
  | "affiliate"
  | "other";

export type RelationExtractionMethod = "xbrl" | "document_text" | "manual";
export type RelationVerificationStatus =
  | "unverified"
  | "verified"
  | "rejected";

export type CompanyRelationInput = {
  parentCompanyId?: number | null;
  childCompanyId?: number | null;
  parentName: string;
  parentNormalizedName?: string;
  childName: string;
  childNormalizedName?: string;
  relationType?: CompanyRelationType;
  ownershipPercent?: number | null;
  indirectOwnershipPercent?: number | null;
  isConsolidated?: boolean | null;
  asOfDate?: string | null;
  sourceDocumentId: string;
  sourceSection?: string;
  sourceLocator?: string | null;
  extractionMethod?: RelationExtractionMethod;
  verificationStatus?: RelationVerificationStatus;
};

export type CompanyRelationRecord = {
  id: number;
  parentCompanyId: number | null;
  childCompanyId: number | null;
  parentName: string;
  parentNormalizedName: string;
  childName: string;
  childNormalizedName: string;
  relationType: CompanyRelationType;
  ownershipPercent: number | null;
  indirectOwnershipPercent: number | null;
  isConsolidated: boolean | null;
  asOfDate: string | null;
  sourceDocumentId: string;
  sourceSection: string;
  sourceLocator: string | null;
  extractionMethod: RelationExtractionMethod;
  verificationStatus: RelationVerificationStatus;
  createdAt: string;
  updatedAt: string;
};

export type CompanyRelationEvidence = CompanyRelationRecord & {
  parentCorporateNumber: string | null;
  parentEdinetCode: string | null;
  childCorporateNumber: string | null;
  childEdinetCode: string | null;
  document: {
    filerName: string;
    documentType: string | null;
    submittedAt: string;
    periodStart: string | null;
    periodEnd: string | null;
    sourceReference: string;
  };
};

type CompanyRow = {
  id: number;
  corporate_number: string | null;
  edinet_code: string | null;
  securities_code: string | null;
  name: string;
  normalized_name: string;
  source_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

type EdinetDocumentRow = {
  doc_id: string;
  filer_company_id: number | null;
  filer_name: string;
  filer_corporate_number: string | null;
  filer_edinet_code: string | null;
  doc_type_code: string | null;
  document_type: string | null;
  submitted_at: string;
  period_start: string | null;
  period_end: string | null;
  source_reference: string;
  fetch_status: EdinetDocumentFetchStatus;
  fetched_at: string | null;
  parsed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type CompanyRelationRow = {
  id: number;
  parent_company_id: number | null;
  child_company_id: number | null;
  parent_name: string;
  parent_normalized_name: string;
  child_name: string;
  child_normalized_name: string;
  relation_type: CompanyRelationType;
  ownership_percent: number | null;
  indirect_ownership_percent: number | null;
  is_consolidated: number | null;
  as_of_date: string | null;
  source_doc_id: string;
  source_section: string;
  source_locator: string | null;
  extraction_method: RelationExtractionMethod;
  verification_status: RelationVerificationStatus;
  created_at: string;
  updated_at: string;
};

type CompanyRelationEvidenceRow = CompanyRelationRow & {
  parent_corporate_number: string | null;
  parent_edinet_code: string | null;
  child_corporate_number: string | null;
  child_edinet_code: string | null;
  document_filer_name: string;
  document_type: string | null;
  document_submitted_at: string;
  document_period_start: string | null;
  document_period_end: string | null;
  document_source_reference: string;
};

export class D1RelationsRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "database_error",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "D1RelationsRepositoryError";
  }
}

export function normalizeCompanyNameForRelations(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・･.,，、'"“”‘’()（）\-‐‑–—―]/gu, "")
    .replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/u, "")
    .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社)$/u, "");
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new D1RelationsRepositoryError(
      `${field}は必須です。`,
      "invalid_input",
    );
  }
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function corporateNumber(value: string | null | undefined): string | null {
  const normalized = optionalText(value);
  if (normalized !== null && !/^\d{13}$/u.test(normalized)) {
    throw new D1RelationsRepositoryError(
      "法人番号は13桁の数字で指定してください。",
      "invalid_input",
    );
  }
  return normalized;
}

function optionalId(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new D1RelationsRepositoryError(
      `${field}は正の整数で指定してください。`,
      "invalid_input",
    );
  }
  return value;
}

function optionalPercentage(
  value: number | null | undefined,
  field: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new D1RelationsRepositoryError(
      `${field}は0以上100以下で指定してください。`,
      "invalid_input",
    );
  }
  return value;
}

function normalizeLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new D1RelationsRepositoryError(
      "limitは1以上100以下の整数で指定してください。",
      "invalid_input",
    );
  }
  return value;
}

function mapCompany(row: CompanyRow): CompanyRecord {
  return {
    id: row.id,
    corporateNumber: row.corporate_number,
    edinetCode: row.edinet_code,
    securitiesCode: row.securities_code,
    name: row.name,
    normalizedName: row.normalized_name,
    sourceUpdatedAt: row.source_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocument(row: EdinetDocumentRow): EdinetDocumentRecord {
  return {
    documentId: row.doc_id,
    filerCompanyId: row.filer_company_id,
    filerName: row.filer_name,
    filerCorporateNumber: row.filer_corporate_number,
    filerEdinetCode: row.filer_edinet_code,
    documentTypeCode: row.doc_type_code,
    documentType: row.document_type,
    submittedAt: row.submitted_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    sourceReference: row.source_reference,
    fetchStatus: row.fetch_status,
    fetchedAt: row.fetched_at,
    parsedAt: row.parsed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelation(row: CompanyRelationRow): CompanyRelationRecord {
  return {
    id: row.id,
    parentCompanyId: row.parent_company_id,
    childCompanyId: row.child_company_id,
    parentName: row.parent_name,
    parentNormalizedName: row.parent_normalized_name,
    childName: row.child_name,
    childNormalizedName: row.child_normalized_name,
    relationType: row.relation_type,
    ownershipPercent: row.ownership_percent,
    indirectOwnershipPercent: row.indirect_ownership_percent,
    isConsolidated:
      row.is_consolidated === null ? null : row.is_consolidated === 1,
    asOfDate: row.as_of_date,
    sourceDocumentId: row.source_doc_id,
    sourceSection: row.source_section,
    sourceLocator: row.source_locator,
    extractionMethod: row.extraction_method,
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvidence(row: CompanyRelationEvidenceRow): CompanyRelationEvidence {
  return {
    ...mapRelation(row),
    parentCorporateNumber: row.parent_corporate_number,
    parentEdinetCode: row.parent_edinet_code,
    childCorporateNumber: row.child_corporate_number,
    childEdinetCode: row.child_edinet_code,
    document: {
      filerName: row.document_filer_name,
      documentType: row.document_type,
      submittedAt: row.document_submitted_at,
      periodStart: row.document_period_start,
      periodEnd: row.document_period_end,
      sourceReference: row.document_source_reference,
    },
  };
}

const COMPANY_COLUMNS = `
  id, corporate_number, edinet_code, securities_code, name,
  normalized_name, source_updated_at, created_at, updated_at
`;

const DOCUMENT_COLUMNS = `
  doc_id, filer_company_id, filer_name, filer_corporate_number,
  filer_edinet_code, doc_type_code, document_type, submitted_at,
  period_start, period_end, source_reference, fetch_status, fetched_at,
  parsed_at, error_message, created_at, updated_at
`;

const RELATION_COLUMNS = `
  id, parent_company_id, child_company_id, parent_name,
  parent_normalized_name, child_name, child_normalized_name, relation_type,
  ownership_percent, indirect_ownership_percent, is_consolidated, as_of_date,
  source_doc_id, source_section, source_locator, extraction_method,
  verification_status, created_at, updated_at
`;

const EVIDENCE_SELECT = `
  SELECT
    relation.*,
    parent.corporate_number AS parent_corporate_number,
    parent.edinet_code AS parent_edinet_code,
    child.corporate_number AS child_corporate_number,
    child.edinet_code AS child_edinet_code,
    document.filer_name AS document_filer_name,
    document.document_type AS document_type,
    document.submitted_at AS document_submitted_at,
    document.period_start AS document_period_start,
    document.period_end AS document_period_end,
    document.source_reference AS document_source_reference
  FROM company_relations AS relation
  LEFT JOIN companies AS parent ON parent.id = relation.parent_company_id
  LEFT JOIN companies AS child ON child.id = relation.child_company_id
  INNER JOIN edinet_documents AS document
    ON document.doc_id = relation.source_doc_id
`;

export class D1CompanyRelationsRepository {
  constructor(private readonly database: D1Database) {}

  private async databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof D1RelationsRepositoryError) throw error;
      throw new D1RelationsRepositoryError(
        "企業関係データベースの操作に失敗しました。",
        "database_error",
        { cause: error },
      );
    }
  }

  async upsertCompany(input: CompanyInput): Promise<CompanyRecord> {
    const companyName = requiredText(input.name, "name");
    const companyCorporateNumber = corporateNumber(input.corporateNumber);
    const companyEdinetCode = optionalText(input.edinetCode);
    if (companyCorporateNumber === null && companyEdinetCode === null) {
      throw new D1RelationsRepositoryError(
        "corporateNumberまたはedinetCodeのどちらかが必要です。",
        "invalid_input",
      );
    }
    const normalizedName = requiredText(
      input.normalizedName ?? normalizeCompanyNameForRelations(companyName),
      "normalizedName",
    );

    return this.databaseOperation(async () => {
      const row = await this.database
        .prepare(`
          INSERT INTO companies (
            corporate_number, edinet_code, securities_code, name,
            normalized_name, source_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT DO UPDATE SET
            corporate_number = COALESCE(excluded.corporate_number, corporate_number),
            edinet_code = COALESCE(excluded.edinet_code, edinet_code),
            securities_code = COALESCE(excluded.securities_code, securities_code),
            name = excluded.name,
            normalized_name = excluded.normalized_name,
            source_updated_at = COALESCE(excluded.source_updated_at, source_updated_at),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          RETURNING ${COMPANY_COLUMNS}
        `)
        .bind(
          companyCorporateNumber,
          companyEdinetCode,
          optionalText(input.securitiesCode),
          companyName,
          normalizedName,
          optionalText(input.sourceUpdatedAt),
        )
        .first<CompanyRow>();
      if (!row) {
        throw new D1RelationsRepositoryError(
          "企業情報を保存できませんでした。",
          "database_error",
        );
      }
      return mapCompany(row);
    });
  }

  async upsertEdinetDocument(
    input: EdinetDocumentInput,
  ): Promise<EdinetDocumentRecord> {
    const documentId = requiredText(input.documentId, "documentId");
    const filerName = requiredText(input.filerName, "filerName");
    const submittedAt = requiredText(input.submittedAt, "submittedAt");
    const sourceReference = requiredText(
      input.sourceReference,
      "sourceReference",
    );

    return this.databaseOperation(async () => {
      const row = await this.database
        .prepare(`
          INSERT INTO edinet_documents (
            doc_id, filer_company_id, filer_name, filer_corporate_number,
            filer_edinet_code, doc_type_code, document_type, submitted_at,
            period_start, period_end, source_reference, fetch_status,
            fetched_at, parsed_at, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(doc_id) DO UPDATE SET
            filer_company_id = COALESCE(excluded.filer_company_id, filer_company_id),
            filer_name = excluded.filer_name,
            filer_corporate_number = COALESCE(
              excluded.filer_corporate_number,
              filer_corporate_number
            ),
            filer_edinet_code = COALESCE(excluded.filer_edinet_code, filer_edinet_code),
            doc_type_code = COALESCE(excluded.doc_type_code, doc_type_code),
            document_type = COALESCE(excluded.document_type, document_type),
            submitted_at = excluded.submitted_at,
            period_start = COALESCE(excluded.period_start, period_start),
            period_end = COALESCE(excluded.period_end, period_end),
            source_reference = excluded.source_reference,
            fetch_status = excluded.fetch_status,
            fetched_at = COALESCE(excluded.fetched_at, fetched_at),
            parsed_at = COALESCE(excluded.parsed_at, parsed_at),
            error_message = excluded.error_message,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          RETURNING ${DOCUMENT_COLUMNS}
        `)
        .bind(
          documentId,
          optionalId(input.filerCompanyId, "filerCompanyId"),
          filerName,
          corporateNumber(input.filerCorporateNumber),
          optionalText(input.filerEdinetCode),
          optionalText(input.documentTypeCode),
          optionalText(input.documentType),
          submittedAt,
          optionalText(input.periodStart),
          optionalText(input.periodEnd),
          sourceReference,
          input.fetchStatus ?? "discovered",
          optionalText(input.fetchedAt),
          optionalText(input.parsedAt),
          optionalText(input.errorMessage),
        )
        .first<EdinetDocumentRow>();
      if (!row) {
        throw new D1RelationsRepositoryError(
          "EDINET文書を保存できませんでした。",
          "database_error",
        );
      }
      return mapDocument(row);
    });
  }

  async upsertCompanyRelation(
    input: CompanyRelationInput,
  ): Promise<CompanyRelationRecord> {
    const parentName = requiredText(input.parentName, "parentName");
    const childName = requiredText(input.childName, "childName");
    const parentNormalizedName = requiredText(
      input.parentNormalizedName ?? normalizeCompanyNameForRelations(parentName),
      "parentNormalizedName",
    );
    const childNormalizedName = requiredText(
      input.childNormalizedName ?? normalizeCompanyNameForRelations(childName),
      "childNormalizedName",
    );

    return this.databaseOperation(async () => {
      const row = await this.database
        .prepare(`
          INSERT INTO company_relations (
            parent_company_id, child_company_id, parent_name,
            parent_normalized_name, child_name, child_normalized_name,
            relation_type, ownership_percent, indirect_ownership_percent,
            is_consolidated, as_of_date, source_doc_id, source_section,
            source_locator, extraction_method, verification_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(
            source_doc_id,
            parent_normalized_name,
            child_normalized_name,
            relation_type
          ) DO UPDATE SET
            parent_company_id = COALESCE(
              excluded.parent_company_id,
              parent_company_id
            ),
            child_company_id = COALESCE(excluded.child_company_id, child_company_id),
            parent_name = excluded.parent_name,
            child_name = excluded.child_name,
            ownership_percent = excluded.ownership_percent,
            indirect_ownership_percent = excluded.indirect_ownership_percent,
            is_consolidated = excluded.is_consolidated,
            as_of_date = COALESCE(excluded.as_of_date, as_of_date),
            source_section = excluded.source_section,
            source_locator = COALESCE(excluded.source_locator, source_locator),
            extraction_method = excluded.extraction_method,
            verification_status = excluded.verification_status,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          RETURNING ${RELATION_COLUMNS}
        `)
        .bind(
          optionalId(input.parentCompanyId, "parentCompanyId"),
          optionalId(input.childCompanyId, "childCompanyId"),
          parentName,
          parentNormalizedName,
          childName,
          childNormalizedName,
          input.relationType ?? "subsidiary",
          optionalPercentage(input.ownershipPercent, "ownershipPercent"),
          optionalPercentage(
            input.indirectOwnershipPercent,
            "indirectOwnershipPercent",
          ),
          input.isConsolidated === null || input.isConsolidated === undefined
            ? null
            : input.isConsolidated
              ? 1
              : 0,
          optionalText(input.asOfDate),
          requiredText(input.sourceDocumentId, "sourceDocumentId"),
          requiredText(input.sourceSection ?? "関係会社の状況", "sourceSection"),
          optionalText(input.sourceLocator),
          input.extractionMethod ?? "xbrl",
          input.verificationStatus ?? "unverified",
        )
        .first<CompanyRelationRow>();
      if (!row) {
        throw new D1RelationsRepositoryError(
          "企業関係を保存できませんでした。",
          "database_error",
        );
      }
      return mapRelation(row);
    });
  }

  async findParentRelationsByCorporateNumber(
    childCorporateNumber: string,
    options: { includeUnverified?: boolean; limit?: number } = {},
  ): Promise<CompanyRelationEvidence[]> {
    const number = corporateNumber(childCorporateNumber);
    if (number === null) {
      throw new D1RelationsRepositoryError(
        "子会社の法人番号が必要です。",
        "invalid_input",
      );
    }
    const limit = normalizeLimit(options.limit ?? 20);
    return this.databaseOperation(async () => {
      const result = await this.database
        .prepare(`
          ${EVIDENCE_SELECT}
          WHERE child.corporate_number = ?
            AND relation.verification_status != 'rejected'
            AND (? = 1 OR relation.verification_status = 'verified')
          ORDER BY
            CASE relation.verification_status WHEN 'verified' THEN 0 ELSE 1 END,
            COALESCE(
              relation.as_of_date,
              document.period_end,
              substr(document.submitted_at, 1, 10)
            ) DESC,
            document.submitted_at DESC
          LIMIT ?
        `)
        .bind(number, options.includeUnverified ? 1 : 0, limit)
        .all<CompanyRelationEvidenceRow>();
      return result.results.map(mapEvidence);
    });
  }

  async findSubsidiariesByCorporateNumber(
    parentCorporateNumber: string,
    options: { includeUnverified?: boolean; limit?: number } = {},
  ): Promise<CompanyRelationEvidence[]> {
    const number = corporateNumber(parentCorporateNumber);
    if (number === null) {
      throw new D1RelationsRepositoryError(
        "親会社の法人番号が必要です。",
        "invalid_input",
      );
    }
    const limit = normalizeLimit(options.limit ?? 50);
    return this.databaseOperation(async () => {
      const result = await this.database
        .prepare(`
          ${EVIDENCE_SELECT}
          WHERE parent.corporate_number = ?
            AND relation.verification_status != 'rejected'
            AND (? = 1 OR relation.verification_status = 'verified')
          ORDER BY
            CASE relation.verification_status WHEN 'verified' THEN 0 ELSE 1 END,
            relation.child_normalized_name ASC,
            COALESCE(
              relation.as_of_date,
              document.period_end,
              substr(document.submitted_at, 1, 10)
            ) DESC
          LIMIT ?
        `)
        .bind(number, options.includeUnverified ? 1 : 0, limit)
        .all<CompanyRelationEvidenceRow>();
      return result.results.map(mapEvidence);
    });
  }
}

export function createD1CompanyRelationsRepository(
  database: D1Database | undefined,
): D1CompanyRelationsRepository | null {
  return database ? new D1CompanyRelationsRepository(database) : null;
}
