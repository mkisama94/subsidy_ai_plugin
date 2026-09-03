export type ResearchSourceType =
  | "official_result"
  | "official_report"
  | "official_budget"
  | "official_guideline"
  | "government_statistics"
  | "secondary_analysis";

export type CountComparability =
  | "confirmed_same_round_and_scope"
  | "not_confirmed"
  | "not_comparable";

export type SelectionEvidenceInput = {
  program: {
    seriesKey: string;
    canonicalName: string;
    institutionName?: string;
  };
  round: {
    jgrantsSubsidyId?: string;
    fiscalYear: number;
    roundName: string;
    scopeKey?: string;
    acceptanceStart?: string;
    acceptanceEnd?: string;
    budgetYen?: number;
    officialDetailUrl?: string;
    lastCheckedAt: string;
  };
  counts: {
    applicationsCount?: number;
    selectedCount?: number;
    denominatorLabel?: string;
    numeratorLabel?: string;
    comparability: CountComparability;
  };
  source: {
    sourceType: ResearchSourceType;
    publisher: string;
    title: string;
    url: string;
    publishedAt?: string;
    retrievedAt: string;
    contentHash: string;
    reliability: "high" | "medium" | "low";
    role:
      | "applications_count"
      | "selected_count"
      | "both_counts"
      | "budget"
      | "methodology";
  };
  basisSummary: string;
  asOfDate: string;
  expiresAt?: string;
};

export type OfficialRateStatus =
  | "official_rate_available"
  | "insufficient_data"
  | "not_comparable";

export type OfficialRateCalculation = {
  status: OfficialRateStatus;
  statusLabel: string;
  officialRate: number | null;
  officialRatePercent: number | null;
  applicationsCount: number | null;
  selectedCount: number | null;
  explanation: string;
};

export class SelectionStatisticsError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "database_error",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SelectionStatisticsError";
  }
}

export async function createResearchSourceHash(evidenceText: string) {
  const bytes = new TextEncoder().encode(evidenceText.normalize("NFKC").trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function isOfficialResearchHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized.endsWith(".go.jp") ||
    normalized.endsWith(".lg.jp") ||
    normalized === "go.jp" ||
    normalized === "lg.jp" ||
    normalized.endsWith(".smrj.go.jp") ||
    normalized === "smrj.go.jp" ||
    normalized.endsWith(".tokyo-kosha.or.jp") ||
    normalized === "tokyo-kosha.or.jp" ||
    normalized.endsWith(".jgrants-portal.go.jp") ||
    normalized === "jgrants-portal.go.jp"
  );
}

function normalizedEvidenceText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, "").trim();
}

function decodeBasicHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, codePoint: string) =>
      String.fromCodePoint(Number(codePoint)),
    )
    .replace(/&#x([0-9a-f]+);/giu, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    );
}

function extractEvidenceSearchText(body: string, contentType: string) {
  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    return body;
  }
  return decodeBasicHtmlEntities(
    body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " "),
  );
}

export async function verifyOfficialResearchSource(
  sourceUrl: string,
  evidenceText: string,
) {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" || !isOfficialResearchHostname(url.hostname)) {
    throw new SelectionStatisticsError(
      "公的機関の公式ドメインにあるHTTPS資料だけを採択実績の出典として保存できます。",
      "invalid_input",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html,text/plain,application/json" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SelectionStatisticsError(
        `公式資料を確認できませんでした（HTTP ${response.status}）。`,
        "invalid_input",
      );
    }
    const finalUrl = new URL(response.url || url.toString());
    if (!isOfficialResearchHostname(finalUrl.hostname)) {
      throw new SelectionStatisticsError(
        "公式ドメイン外へ転送されたため、採択実績を保存しません。",
        "invalid_input",
      );
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      !contentType.includes("text/") &&
      !contentType.includes("application/json") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new SelectionStatisticsError(
        "この資料形式は根拠本文を自動照合できません。現段階では公式HTML、テキスト、JSON資料だけを保存できます。",
        "invalid_input",
      );
    }
    const body = await response.text();
    if (body.length > 5_000_000) {
      throw new SelectionStatisticsError(
        "公式資料が大きすぎるため自動照合できません。",
        "invalid_input",
      );
    }
    const normalizedBody = normalizedEvidenceText(
      extractEvidenceSearchText(body, contentType),
    );
    const normalizedEvidence = normalizedEvidenceText(evidenceText);
    if (!normalizedEvidence || !normalizedBody.includes(normalizedEvidence)) {
      throw new SelectionStatisticsError(
        "入力された根拠文を公式資料内で確認できないため、採択実績を保存しません。",
        "invalid_input",
      );
    }
    return {
      contentHash: await createResearchSourceHash(body),
      verifiedUrl: finalUrl.toString(),
      contentType,
    };
  } catch (error) {
    if (error instanceof SelectionStatisticsError) throw error;
    throw new SelectionStatisticsError(
      "公式資料への接続に失敗したため、採択実績を保存しません。",
      "invalid_input",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

const OFFICIAL_COUNT_SOURCES = new Set<ResearchSourceType>([
  "official_result",
  "official_report",
  "government_statistics",
]);

function nullableCount(value: number | undefined, field: string): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SelectionStatisticsError(
      `${field}は0以上の整数で指定してください。`,
      "invalid_input",
    );
  }
  return value;
}

export function calculateOfficialSelectionRate(
  counts: SelectionEvidenceInput["counts"],
  sourceType: ResearchSourceType,
): OfficialRateCalculation {
  const applicationsCount = nullableCount(
    counts.applicationsCount,
    "applicationsCount",
  );
  const selectedCount = nullableCount(counts.selectedCount, "selectedCount");
  if (selectedCount !== null && applicationsCount !== null && selectedCount > applicationsCount) {
    throw new SelectionStatisticsError(
      "採択件数が申請件数を上回っているため、公式採択率を計算できません。",
      "invalid_input",
    );
  }
  if (!OFFICIAL_COUNT_SOURCES.has(sourceType)) {
    return {
      status: "insufficient_data",
      statusLabel: "公式採択率は不明です",
      officialRate: null,
      officialRatePercent: null,
      applicationsCount,
      selectedCount,
      explanation:
        "実施機関または政府の公式資料ではないため、公式採択率として計算しません。",
    };
  }
  if (applicationsCount === null || applicationsCount === 0 || selectedCount === null) {
    return {
      status: "insufficient_data",
      statusLabel: "公式採択率は不明です",
      officialRate: null,
      officialRatePercent: null,
      applicationsCount,
      selectedCount,
      explanation:
        "同じ公募回の申請件数と採択件数が両方揃っていないため、公式採択率を計算しません。",
    };
  }
  if (counts.comparability !== "confirmed_same_round_and_scope") {
    return {
      status: "not_comparable",
      statusLabel: "公式採択率は算定できません",
      officialRate: null,
      officialRatePercent: null,
      applicationsCount,
      selectedCount,
      explanation:
        "申請件数と採択件数が同じ公募回・同じ対象範囲の数値であることを確認できないため、割り算しません。",
    };
  }
  const officialRate = selectedCount / applicationsCount;
  return {
    status: "official_rate_available",
    statusLabel: "過去の公式採択率を確認できました",
    officialRate,
    officialRatePercent: Math.round(officialRate * 10_000) / 100,
    applicationsCount,
    selectedCount,
    explanation: `${counts.denominatorLabel ?? "申請件数"}${applicationsCount.toLocaleString("ja-JP")}件に対し、${counts.numeratorLabel ?? "採択件数"}${selectedCount.toLocaleString("ja-JP")}件として計算しました。`,
  };
}

type IdRow = { id: number };
type ExistingStatisticRow = {
  applicationsCount: number | null;
  selectedCount: number | null;
  denominatorLabel: string | null;
  numeratorLabel: string | null;
  comparability: CountComparability;
  officialRate: number | null;
  basisSummary: string;
};

function isCountSourceRole(role: SelectionEvidenceInput["source"]["role"]) {
  return (
    role === "applications_count" ||
    role === "selected_count" ||
    role === "both_counts"
  );
}

export class D1SelectionStatisticsRepository {
  constructor(private readonly database: D1Database) {}

  private async operation<T>(callback: () => Promise<T>): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof SelectionStatisticsError) throw error;
      throw new SelectionStatisticsError(
        "補助金採択実績データベースの操作に失敗しました。",
        "database_error",
        { cause: error },
      );
    }
  }

  async saveEvidence(input: SelectionEvidenceInput) {
    if (
      isCountSourceRole(input.source.role) &&
      !OFFICIAL_COUNT_SOURCES.has(input.source.sourceType)
    ) {
      throw new SelectionStatisticsError(
        "申請件数・採択件数の根拠には、公式採択結果・公式報告書・政府統計のいずれかを指定してください。",
        "invalid_input",
      );
    }
    return this.operation(async () => {
      const program = await this.database
        .prepare(`
          INSERT INTO subsidy_programs (
            program_series_key, canonical_name, institution_name
          ) VALUES (?, ?, ?)
          ON CONFLICT(program_series_key) DO UPDATE SET
            canonical_name = excluded.canonical_name,
            institution_name = COALESCE(excluded.institution_name, institution_name),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          RETURNING id
        `)
        .bind(
          input.program.seriesKey.trim(),
          input.program.canonicalName.trim(),
          input.program.institutionName?.trim() || null,
        )
        .first<IdRow>();
      if (!program) throw new SelectionStatisticsError("補助金制度を保存できませんでした。", "database_error");

      const round = await this.database
        .prepare(`
          INSERT INTO subsidy_rounds (
            program_id, jgrants_subsidy_id, fiscal_year, round_name, scope_key,
            acceptance_start, acceptance_end, budget_yen, official_detail_url,
            last_checked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(program_id, fiscal_year, round_name, scope_key) DO UPDATE SET
            jgrants_subsidy_id = COALESCE(excluded.jgrants_subsidy_id, jgrants_subsidy_id),
            acceptance_start = COALESCE(excluded.acceptance_start, acceptance_start),
            acceptance_end = COALESCE(excluded.acceptance_end, acceptance_end),
            budget_yen = COALESCE(excluded.budget_yen, budget_yen),
            official_detail_url = COALESCE(excluded.official_detail_url, official_detail_url),
            last_checked_at = excluded.last_checked_at,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          RETURNING id
        `)
        .bind(
          program.id,
          input.round.jgrantsSubsidyId?.trim() || null,
          input.round.fiscalYear,
          input.round.roundName.trim(),
          input.round.scopeKey?.trim() || "overall",
          input.round.acceptanceStart?.trim() || null,
          input.round.acceptanceEnd?.trim() || null,
          input.round.budgetYen ?? null,
          input.round.officialDetailUrl?.trim() || null,
          input.round.lastCheckedAt,
        )
        .first<IdRow>();
      if (!round) throw new SelectionStatisticsError("公募回を保存できませんでした。", "database_error");

      const existing = await this.database
        .prepare(`
          SELECT
            applications_count AS applicationsCount,
            selected_count AS selectedCount,
            denominator_label AS denominatorLabel,
            numerator_label AS numeratorLabel,
            comparability,
            official_rate AS officialRate,
            basis_summary AS basisSummary
          FROM subsidy_selection_statistics
          WHERE subsidy_round_id = ?
        `)
        .bind(round.id)
        .first<ExistingStatisticRow>();
      const countEvidence = isCountSourceRole(input.source.role);
      const mergedCounts = {
        applicationsCount: countEvidence
          ? (input.counts.applicationsCount ?? existing?.applicationsCount ?? undefined)
          : (existing?.applicationsCount ?? undefined),
        selectedCount: countEvidence
          ? (input.counts.selectedCount ?? existing?.selectedCount ?? undefined)
          : (existing?.selectedCount ?? undefined),
        denominatorLabel: countEvidence
          ? (input.counts.denominatorLabel ?? existing?.denominatorLabel ?? undefined)
          : (existing?.denominatorLabel ?? undefined),
        numeratorLabel: countEvidence
          ? (input.counts.numeratorLabel ?? existing?.numeratorLabel ?? undefined)
          : (existing?.numeratorLabel ?? undefined),
        comparability: countEvidence
          ? input.counts.comparability
          : (existing?.comparability ?? input.counts.comparability),
      };
      const calculation = countEvidence
        ? calculateOfficialSelectionRate(mergedCounts, input.source.sourceType)
        : existing
          ? {
              status: existing.officialRate === null
                ? "insufficient_data" as const
                : "official_rate_available" as const,
              statusLabel: existing.officialRate === null
                ? "公式採択率は不明です"
                : "過去の公式採択率を確認できました",
              officialRate: existing.officialRate,
              officialRatePercent: existing.officialRate === null
                ? null
                : Math.round(existing.officialRate * 10_000) / 100,
              applicationsCount: existing.applicationsCount,
              selectedCount: existing.selectedCount,
              explanation: "件数以外の追加資料として保存し、既存の採択実績は変更していません。",
            }
          : calculateOfficialSelectionRate(mergedCounts, input.source.sourceType);

      const source = await this.database
        .prepare(`
          INSERT INTO research_sources (
            source_type, publisher, title, url, published_at, retrieved_at,
            content_hash, reliability
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(url, content_hash) DO UPDATE SET
            publisher = excluded.publisher,
            title = excluded.title,
            published_at = COALESCE(excluded.published_at, published_at),
            retrieved_at = excluded.retrieved_at,
            reliability = excluded.reliability
          RETURNING id
        `)
        .bind(
          input.source.sourceType,
          input.source.publisher.trim(),
          input.source.title.trim(),
          input.source.url.trim(),
          input.source.publishedAt?.trim() || null,
          input.source.retrievedAt,
          input.source.contentHash.trim(),
          input.source.reliability,
        )
        .first<IdRow>();
      if (!source) throw new SelectionStatisticsError("調査出典を保存できませんでした。", "database_error");

      const statistic = await this.database
        .prepare(`
          INSERT INTO subsidy_selection_statistics (
            subsidy_round_id, applications_count, selected_count,
            denominator_label, numerator_label, comparability, official_rate,
            basis_summary, as_of_date, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(subsidy_round_id) DO UPDATE SET
            applications_count = excluded.applications_count,
            selected_count = excluded.selected_count,
            denominator_label = excluded.denominator_label,
            numerator_label = excluded.numerator_label,
            comparability = excluded.comparability,
            official_rate = excluded.official_rate,
            basis_summary = excluded.basis_summary,
            as_of_date = excluded.as_of_date,
            expires_at = excluded.expires_at,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          RETURNING id
        `)
        .bind(
          round.id,
          mergedCounts.applicationsCount ?? null,
          mergedCounts.selectedCount ?? null,
          mergedCounts.denominatorLabel?.trim() || null,
          mergedCounts.numeratorLabel?.trim() || null,
          mergedCounts.comparability,
          calculation.officialRate,
          countEvidence || !existing
            ? input.basisSummary.trim()
            : existing.basisSummary,
          input.asOfDate,
          input.expiresAt?.trim() || null,
        )
        .first<IdRow>();
      if (!statistic) throw new SelectionStatisticsError("採択実績を保存できませんでした。", "database_error");

      await this.database
        .prepare(`
          INSERT OR IGNORE INTO selection_statistic_sources (
            statistic_id, source_id, role
          ) VALUES (?, ?, ?)
        `)
        .bind(statistic.id, source.id, input.source.role)
        .run();

      return {
        status: "stored" as const,
        programId: program.id,
        roundId: round.id,
        statisticId: statistic.id,
        sourceId: source.id,
        calculation,
      };
    });
  }

  async findByJgrantsSubsidyId(jgrantsSubsidyId: string) {
    return this.operation(async () => {
      const statistics = await this.database
        .prepare(`
          SELECT
            program.program_series_key AS programSeriesKey,
            program.canonical_name AS canonicalName,
            program.institution_name AS institutionName,
            round.jgrants_subsidy_id AS jgrantsSubsidyId,
            round.fiscal_year AS fiscalYear,
            round.round_name AS roundName,
            round.scope_key AS scopeKey,
            round.official_detail_url AS officialDetailUrl,
            statistic.applications_count AS applicationsCount,
            statistic.selected_count AS selectedCount,
            statistic.denominator_label AS denominatorLabel,
            statistic.numerator_label AS numeratorLabel,
            statistic.comparability,
            statistic.official_rate AS officialRate,
            statistic.estimated_rate_low AS estimatedRateLow,
            statistic.estimated_rate_mid AS estimatedRateMid,
            statistic.estimated_rate_high AS estimatedRateHigh,
            statistic.confidence,
            statistic.basis_summary AS basisSummary,
            statistic.estimate_basis_summary AS estimateBasisSummary,
            statistic.as_of_date AS asOfDate,
            statistic.expires_at AS expiresAt
          FROM subsidy_rounds AS round
          INNER JOIN subsidy_programs AS program ON program.id = round.program_id
          LEFT JOIN subsidy_selection_statistics AS statistic
            ON statistic.subsidy_round_id = round.id
          WHERE round.jgrants_subsidy_id = ?
          ORDER BY statistic.as_of_date DESC
        `)
        .bind(jgrantsSubsidyId.trim())
        .all<Record<string, unknown>>();
      const sources = await this.database
        .prepare(`
          SELECT
            statistic.id AS statisticId,
            source.source_type AS sourceType,
            source.publisher,
            source.title,
            source.url,
            source.published_at AS publishedAt,
            source.retrieved_at AS retrievedAt,
            source.content_hash AS contentHash,
            source.reliability,
            link.role
          FROM selection_statistic_sources AS link
          INNER JOIN subsidy_selection_statistics AS statistic
            ON statistic.id = link.statistic_id
          INNER JOIN subsidy_rounds AS round
            ON round.id = statistic.subsidy_round_id
          INNER JOIN research_sources AS source ON source.id = link.source_id
          WHERE round.jgrants_subsidy_id = ?
          ORDER BY source.published_at DESC, source.id DESC
        `)
        .bind(jgrantsSubsidyId.trim())
        .all<Record<string, unknown>>();
      return { statistics: statistics.results, sources: sources.results };
    });
  }

  async historicalOfficialRates(programSeriesKey: string, limit = 3) {
    return this.operation(async () => {
      const result = await this.database
        .prepare(`
          SELECT
            round.fiscal_year AS fiscalYear,
            round.round_name AS roundName,
            statistic.applications_count AS applicationsCount,
            statistic.selected_count AS selectedCount,
            statistic.official_rate AS officialRate,
            statistic.as_of_date AS asOfDate
          FROM subsidy_selection_statistics AS statistic
          INNER JOIN subsidy_rounds AS round ON round.id = statistic.subsidy_round_id
          INNER JOIN subsidy_programs AS program ON program.id = round.program_id
          WHERE program.program_series_key = ?
            AND statistic.official_rate IS NOT NULL
          ORDER BY round.fiscal_year DESC, round.id DESC
          LIMIT ?
        `)
        .bind(programSeriesKey.trim(), Math.max(1, Math.min(10, limit)))
        .all<HistoricalSelectionRate>();
      return result.results;
    });
  }

  async saveEstimateForJgrantsId(
    jgrantsSubsidyId: string,
    outlook: ReturnType<typeof estimateSelectionOutlook>,
    asOfDate: string,
  ) {
    if (outlook.status !== "estimated") {
      return { status: "not_saved" as const, reason: "estimate_withheld" as const };
    }
    return this.operation(async () => {
      const estimateBasisSummary = [outlook.reason, ...outlook.adjustments].join(" ");
      const row = await this.database
        .prepare(`
          INSERT INTO subsidy_selection_statistics (
            subsidy_round_id, comparability, estimated_rate_low,
            estimated_rate_mid, estimated_rate_high, estimation_method,
            methodology_version, confidence, basis_summary,
            estimate_basis_summary, as_of_date
          )
          SELECT
            round.id, 'not_confirmed', ?, ?, ?, ?, ?, ?,
            '公式採択率の算定に必要な件数は未登録です。', ?, ?
          FROM subsidy_rounds AS round
          WHERE round.jgrants_subsidy_id = ?
          ON CONFLICT(subsidy_round_id) DO UPDATE SET
            estimated_rate_low = excluded.estimated_rate_low,
            estimated_rate_mid = excluded.estimated_rate_mid,
            estimated_rate_high = excluded.estimated_rate_high,
            estimation_method = excluded.estimation_method,
            methodology_version = excluded.methodology_version,
            confidence = excluded.confidence,
            estimate_basis_summary = excluded.estimate_basis_summary,
            as_of_date = excluded.as_of_date,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          RETURNING id
        `)
        .bind(
          outlook.estimatedRateLow,
          outlook.estimatedRateMid,
          outlook.estimatedRateHigh,
          "historical_weighted_rate_with_public_adjustments",
          outlook.methodologyVersion,
          outlook.confidence,
          estimateBasisSummary,
          asOfDate,
          jgrantsSubsidyId.trim(),
        )
        .first<IdRow>();
      return row
        ? { status: "stored" as const, statisticId: row.id }
        : {
            status: "not_saved" as const,
            reason: "target_round_not_found" as const,
          };
    });
  }
}

export type HistoricalSelectionRate = {
  fiscalYear: number;
  roundName: string;
  applicationsCount: number;
  selectedCount: number;
  officialRate: number;
  asOfDate: string;
};

export type SelectionOutlookInput = {
  eligibilityStatus:
    | "eligible"
    | "conditional"
    | "needs_confirmation"
    | "likely_ineligible";
  historicalRates: HistoricalSelectionRate[];
  budgetChangePercent?: number;
  maximumGrantChangePercent?: number;
  targetScopeChange?: "expanded" | "unchanged" | "narrowed" | "unknown";
  programContinuity?: "continuing" | "new" | "unknown";
};

function clampRate(value: number) {
  return Math.max(0, Math.min(1, value));
}

function roundRate(value: number) {
  return Math.round(clampRate(value) * 10_000) / 10_000;
}

export function estimateSelectionOutlook(input: SelectionOutlookInput) {
  if (input.eligibilityStatus !== "eligible") {
    return {
      status: "withheld" as const,
      statusLabel: "今回の採択見通しは判定保留です",
      reason:
        input.eligibilityStatus === "likely_ineligible"
          ? "申請資格について対象外となる可能性が高いため、採択見通しを計算しません。"
          : "申請資格が確定していないため、採択見通しを計算しません。",
      estimatedRateLow: null,
      estimatedRateMid: null,
      estimatedRateHigh: null,
      confidence: null,
      methodologyVersion: "rule_based_v1",
    };
  }
  const history = input.historicalRates
    .filter((item) => item.applicationsCount > 0 && item.selectedCount >= 0)
    .slice(0, 3);
  if (!history.length) {
    return {
      status: "withheld" as const,
      statusLabel: "今回の採択見通しは不明です",
      reason: "比較可能な過去の公式採択実績がないため、推定しません。",
      estimatedRateLow: null,
      estimatedRateMid: null,
      estimatedRateHigh: null,
      confidence: null,
      methodologyVersion: "rule_based_v1",
    };
  }
  const applications = history.reduce((sum, item) => sum + item.applicationsCount, 0);
  const selected = history.reduce((sum, item) => sum + item.selectedCount, 0);
  const baseRate = selected / applications;
  let multiplier = 1;
  const adjustments: string[] = [];
  if (input.budgetChangePercent !== undefined) {
    const factor = Math.sqrt(Math.max(0.25, 1 + input.budgetChangePercent / 100));
    multiplier *= Math.max(0.8, Math.min(1.2, factor));
    adjustments.push(`予算変化${input.budgetChangePercent}%を限定的に反映`);
  }
  if (input.maximumGrantChangePercent !== undefined) {
    const factor = 1 / Math.sqrt(Math.max(0.25, 1 + input.maximumGrantChangePercent / 100));
    multiplier *= Math.max(0.85, Math.min(1.15, factor));
    adjustments.push(`補助上限変化${input.maximumGrantChangePercent}%を限定的に反映`);
  }
  if (input.targetScopeChange === "expanded") {
    multiplier *= 0.9;
    adjustments.push("対象範囲拡大による応募増加可能性を反映");
  } else if (input.targetScopeChange === "narrowed") {
    multiplier *= 1.1;
    adjustments.push("対象範囲縮小による応募減少可能性を反映");
  }
  const mid = clampRate(baseRate * multiplier);
  const confidence =
    history.length >= 3 && applications >= 500 && input.programContinuity === "continuing"
      ? "high"
      : history.length >= 2 && input.programContinuity !== "new"
        ? "medium"
        : "low";
  const margin = confidence === "high" ? 0.05 : confidence === "medium" ? 0.1 : 0.15;
  return {
    status: "estimated" as const,
    statusLabel: "制度全体の採択見通しを参考範囲として算定しました",
    reason:
      "過去の公式実績の加重平均を基準に、公開された制度変更だけをルールで補正しました。個別企業の採択確率ではありません。",
    historicalWeightedRate: roundRate(baseRate),
    estimatedRateLow: roundRate(mid - margin),
    estimatedRateMid: roundRate(mid),
    estimatedRateHigh: roundRate(mid + margin),
    confidence,
    methodologyVersion: "rule_based_v1",
    historyUsed: history,
    adjustments,
  };
}

export function createD1SelectionStatisticsRepository(database: D1Database | undefined) {
  return database ? new D1SelectionStatisticsRepository(database) : null;
}

export async function recordSelectionEvidence(
  input: SelectionEvidenceInput,
  repository: D1SelectionStatisticsRepository | null,
) {
  const inputCalculation = calculateOfficialSelectionRate(
    input.counts,
    input.source.sourceType,
  );
  const persistence = repository
    ? await repository.saveEvidence(input)
    : ({ status: "not_configured" } as const);
  const calculation =
    persistence.status === "stored"
      ? persistence.calculation
      : inputCalculation;
  return {
    calculation,
    source: input.source,
    round: input.round,
    persistence,
    displayGuidance:
      "利用者向けには『過去の公式採択率』と表示し、個別企業の採択確率とは説明しないでください。内部IDや保存状態は求められない限り表示しません。",
  };
}
