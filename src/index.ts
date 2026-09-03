import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { D1PublicApiCache } from "./cache";
import { getSubsidyDetail, JGrantsApiError, searchSubsidies } from "./jgrants";
import { evaluateSubsidyFit } from "./matching";
import {
  GBizInfoApiError,
  getCompanyProfile,
  searchCompanies,
} from "./gbizinfo";
import { evaluateSubsidyFitForCompany } from "./companyMatching";
import {
  GBIZINFO_ACTIVITY_TYPES,
  getCompanyActivities,
} from "./gbizinfoActivities";
import { EdinetApiError } from "./edinet";
import { createD1CompanyRelationsRepository } from "./d1Relations";
import { verifyAndStoreCorporateRelationship } from "./edinetRelationsService";
import { assessDeemedLargeEnterpriseEligibility } from "./deemedLargeEnterprise";

const SERVER_NAME = "subsidy-ai-mcp";
const SERVER_VERSION = "0.8.0";

function jsonToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorToolResult(error: unknown) {
  const known =
    error instanceof JGrantsApiError ||
    error instanceof GBizInfoApiError ||
    error instanceof EdinetApiError;
  const payload = {
    error: {
      code: known ? error.code : "internal_error",
      message: known
        ? error.message
        : "公的情報の取得中に予期しないエラーが発生しました。",
      retryable: known
        ? error.code === "timeout" ||
          error.code === "upstream_error" ||
          error.code === "rate_limited"
        : false,
    },
  };
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

type Env = {
  GBIZINFO_API_TOKEN?: string;
  EDINET_API_KEY?: string;
  CACHE_KEY_SECRET?: string;
  PUBLIC_CACHE?: D1Database;
  subsidy_ai_relations?: D1Database;
};

function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  const publicCacheDatabase =
    env.PUBLIC_CACHE ?? env.subsidy_ai_relations;
  const jGrantsCacheOptions = {
    cache: publicCacheDatabase
      ? new D1PublicApiCache(publicCacheDatabase)
      : undefined,
    searchCacheKeySecret: env.CACHE_KEY_SECRET,
  };

  server.registerTool(
    "search_companies",
    {
      description:
        "経済産業省の法人情報データベース（gBizINFO）で法人名を検索し、法人番号・所在地を含む候補を返します。利用者向け回答では単に『gBizINFO』とせず、『経済産業省の法人情報データベース』と説明してください。同名法人など複数候補がある場合は自動決定せず、利用者に所在地や正式名称を確認してください。mayHaveMoreがtrueなら先頭ページだけであることを明示してください。statusAvailabilityがnot_providedの法人を登記中・存続中と断定しないでください。候補確定後はget_company_profileを使用します。",
      inputSchema: {
        name: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe("検索する法人名。正式名称が望ましい"),
        prefecture: z
          .string()
          .trim()
          .min(1)
          .max(20)
          .optional()
          .describe("候補を絞り込む都道府県。例: 東京都"),
        city: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe("候補を絞り込む市区町村。例: 千代田区"),
        page: z.number().int().min(1).max(10_000).optional().default(1),
        limit: z.number().int().min(1).max(20).optional().default(10),
      },
    },
    async ({ name, prefecture, city, page, limit }) => {
      try {
        return jsonToolResult(
          await searchCompanies(
            { name, prefecture, city, page, limit },
            env.GBIZINFO_API_TOKEN,
          ),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );

  server.registerTool(
    "get_company_profile",
    {
      description:
        "法人番号から経済産業省の法人情報データベース（gBizINFO）にある公開法人基本情報を取得します。利用者向け回答では単に『gBizINFO』とせず、『経済産業省の法人情報データベース』と説明してください。所在地、業種、従業員数、資本金などを返します。活動情報は完全性を保証できない基本情報レスポンスから数えず、not_fetchedとして返します。認定、特許、補助金などはget_company_activitiesを使用してください。未登録項目は推測せずnullまたは空配列で返し、statusAvailabilityがnot_providedの場合は登記中・存続中と断定しません。",
      inputSchema: {
        corporate_number: z
          .string()
          .trim()
          .regex(/^\d{13}$/)
          .describe("13桁の法人番号"),
        activity_limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(20)
          .describe(
            "後方互換用。活動情報は取得しないため、get_company_activitiesのactivity_limitを使用してください",
          ),
      },
    },
    async ({ corporate_number, activity_limit }) => {
      try {
        return jsonToolResult(
          await getCompanyProfile(
            corporate_number,
            env.GBIZINFO_API_TOKEN,
            activity_limit,
          ),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );

  server.registerTool(
    "get_company_activities",
    {
      description:
        "法人番号から経済産業省の法人情報データベース（gBizINFO）にある活動情報を取得します。利用者向け回答では単に『gBizINFO』とせず、『経済産業省の法人情報データベース』と説明してください。届出・認定、表彰、事業所、財務、特許・意匠・商標、調達、補助金、職場情報を返します。法人名検索のactivityCountはこれらの総合指標であり、特定種類の件数とは限りません。種類別件数、取得失敗、検索APIの報告件数との差を分けて返します。",
      inputSchema: {
        corporate_number: z
          .string()
          .trim()
          .regex(/^\d{13}$/)
          .describe("活動情報を取得する13桁の法人番号"),
        activity_types: z
          .array(z.enum(GBIZINFO_ACTIVITY_TYPES))
          .min(1)
          .max(GBIZINFO_ACTIVITY_TYPES.length)
          .optional()
          .default([...GBIZINFO_ACTIVITY_TYPES])
          .describe(
            "取得する活動情報の種類。省略時は8種類すべてを取得",
          ),
        activity_limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(20)
          .describe("各活動種類の最大返却件数。総件数は切り捨て前を返す"),
      },
    },
    async ({ corporate_number, activity_types, activity_limit }) => {
      try {
        return jsonToolResult(
          await getCompanyActivities(
            corporate_number,
            env.GBIZINFO_API_TOKEN,
            activity_types,
            activity_limit,
          ),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );

  server.registerTool(
    "verify_corporate_relationship",
    {
      description:
        "利用者が申告した親会社候補を、金融庁EDINETの最新の有価証券報告書で検証します。親会社をゼロから推測するツールではありません。対象会社名が書類にない場合も資本関係なしとは断定しません。statusやpersistenceの英語値、relationIdなどは内部処理用です。利用者向け回答では自然な日本語に言い換え、保存状態や内部IDは求められない限り表示しないでください。関係が確認できても、資本関係だけで補助金候補から除外しないでください。候補制度の最新の公募要領または公式FAQを確認し、assess_deemed_large_enterprise_eligibilityで制度別に照合してください。",
      inputSchema: {
        target_company_name: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe("親子関係を確認したい対象会社の正式名称"),
        target_corporate_number: z
          .string()
          .trim()
          .regex(/^\d{13}$/)
          .optional()
          .describe("対象会社の13桁の法人番号。判明している場合に指定"),
        parent_company_name: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe("利用者が申告した親会社候補の正式名称"),
        parent_corporate_number: z
          .string()
          .trim()
          .regex(/^\d{13}$/)
          .optional()
          .describe("親会社候補の13桁の法人番号。同名候補の特定に使用"),
        filing_date: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe(
            "有価証券報告書の提出日。分かる場合にYYYY-MM-DDで指定すると、その日だけを照会",
          ),
        document_id: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9]+$/)
          .max(20)
          .optional()
          .describe(
            "EDINETの書類管理番号。分かる場合は提出日検索を省略して直接検証",
          ),
      },
    },
    async ({
      target_company_name,
      target_corporate_number,
      parent_company_name,
      parent_corporate_number,
      filing_date,
      document_id,
    }) => {
      try {
        return jsonToolResult(
          await verifyAndStoreCorporateRelationship(
            {
              targetCompanyName: target_company_name,
              targetCorporateNumber: target_corporate_number,
              parentCompanyName: parent_company_name,
              parentCorporateNumber: parent_corporate_number,
              filingDate: filing_date,
              documentId: document_id,
            },
            env.EDINET_API_KEY,
            createD1CompanyRelationsRepository(env.subsidy_ai_relations),
          ),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );
  server.registerTool(
    "assess_deemed_large_enterprise_eligibility",
    {
      description:
        "候補となった補助金の公式資料にある『みなし大企業』の扱いと、EDINET等で確認した公開資本関係を照合します。100%子会社という事実だけで全制度を対象外にせず、制度が申請を認める場合、対象外とする場合、条件付きの場合を分けます。program_ruleは必ず最新の公募要領・公式FAQなどから入力し、source_urlと確認日を付けてください。single_large_owner_percent等は、株主がその制度上の大企業に該当すると確認できた場合だけ入力してください。課税所得や役員兼務など公開情報で確認できない値は推測せず省略してください。英語のstatusは内部処理用であり、利用者向け回答ではstatusLabelとsummaryを自然な日本語で使用してください。入力と判定結果は保存しません。",
      inputSchema: {
        subsidy_id: z
          .string()
          .trim()
          .min(1)
          .max(18)
          .regex(/^[A-Za-z0-9]+$/)
          .describe("対象となるJグランツの補助金ID"),
        program_rule: z.object({
          treatment: z
            .enum(["excluded", "allowed", "conditional", "not_stated"])
            .describe(
              "公式資料における扱い。対象外、申請可能、条件付き、明記なしのいずれか",
            ),
          single_large_owner_threshold_percent: z
            .number()
            .min(0)
            .max(100)
            .optional()
            .describe("単一の大企業による保有割合の対象外基準（%）"),
          multiple_large_owners_threshold_percent: z
            .number()
            .min(0)
            .max(100)
            .optional()
            .describe("複数大企業の合計保有割合の対象外基準（%）"),
          officer_overlap_threshold_percent: z
            .number()
            .min(0)
            .max(100)
            .optional()
            .describe("大企業の役員・職員が兼務する役員割合の基準（%）"),
          indirect_ownership_included: z
            .boolean()
            .optional()
            .default(false)
            .describe("間接保有・孫会社等を対象外基準に含むか"),
          high_income_rule_included: z
            .boolean()
            .optional()
            .default(false)
            .describe("課税所得等の非公開情報に関する基準を含むか"),
          source_url: z
            .url()
            .refine((value) => value.startsWith("https://"), {
              message: "公式資料のHTTPS URLを指定してください",
            })
            .describe("判定基準を確認した公募要領または公式FAQのURL"),
          source_title: z.string().trim().min(1).max(300).optional(),
          source_section: z
            .string()
            .trim()
            .min(1)
            .max(300)
            .optional()
            .describe("根拠となるページ番号または節見出し"),
          checked_at: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe("公式資料を確認した日（YYYY-MM-DD）"),
        }),
        affiliation_facts: z.object({
          single_large_owner_percent: z
            .number()
            .min(0)
            .max(100)
            .optional()
            .describe("制度上の大企業に該当する単一株主の確認済み保有割合"),
          multiple_large_owners_percent: z
            .number()
            .min(0)
            .max(100)
            .optional()
            .describe("制度上の大企業に該当する複数株主の確認済み合計保有割合"),
          officer_overlap_percent: z
            .number()
            .min(0)
            .max(100)
            .optional()
            .describe("公開情報または利用者確認による役員・職員兼務割合"),
          indirectly_controlled_by_large_enterprise: z.boolean().optional(),
          high_income_rule_applies: z
            .boolean()
            .optional()
            .describe("利用者が確認した場合のみ指定。課税所得そのものは入力しない"),
          conditional_requirement_met: z
            .boolean()
            .optional()
            .describe("条件付きで申請可能な制度について、公式条件を満たすか"),
        }),
      },
    },
    async ({ subsidy_id, program_rule, affiliation_facts }) =>
      jsonToolResult(
        assessDeemedLargeEnterpriseEligibility(
          subsidy_id,
          {
            treatment: program_rule.treatment,
            singleLargeOwnerThresholdPercent:
              program_rule.single_large_owner_threshold_percent,
            multipleLargeOwnersThresholdPercent:
              program_rule.multiple_large_owners_threshold_percent,
            officerOverlapThresholdPercent:
              program_rule.officer_overlap_threshold_percent,
            indirectOwnershipIncluded:
              program_rule.indirect_ownership_included,
            highIncomeRuleIncluded: program_rule.high_income_rule_included,
            sourceUrl: program_rule.source_url,
            sourceTitle: program_rule.source_title,
            sourceSection: program_rule.source_section,
            checkedAt: program_rule.checked_at,
          },
          {
            singleLargeOwnerPercent:
              affiliation_facts.single_large_owner_percent,
            multipleLargeOwnersPercent:
              affiliation_facts.multiple_large_owners_percent,
            officerOverlapPercent: affiliation_facts.officer_overlap_percent,
            indirectlyControlledByLargeEnterprise:
              affiliation_facts.indirectly_controlled_by_large_enterprise,
            highIncomeRuleApplies: affiliation_facts.high_income_rule_applies,
            conditionalRequirementMet:
              affiliation_facts.conditional_requirement_met,
          },
        ),
      ),
  );
  server.registerTool(
    "evaluate_subsidy_fit_for_company",
    {
      description:
        "法人番号から経済産業省の法人情報データベース（gBizINFO）の企業プロフィールを取得し、指定したJグランツ補助金の公開条件と照合します。利用者向け回答では単に『gBizINFO』とせず、『経済産業省の法人情報データベース』と説明してください。公開情報で未登録または古い所在地、業種、従業員数、資本金は利用者の明示入力で補完でき、各値の出典と矛盾も返します。中小企業要件がある制度では親会社・大企業からの出資関係を利用者に確認し、親会社候補が示された場合はverify_corporate_relationshipで検証してください。ただし、資本関係だけで候補から除外せず、公式資料の制度別基準をassess_deemed_large_enterprise_eligibilityで照合してください。assessment.assessment.statusは内部処理用です。利用者向け回答には英語コードを表示せず、assessment.assessment.statusLabelとsummaryを使って自然な日本語で説明してください。申請資格や採択を断定しません。",
      inputSchema: {
        subsidy_id: z
          .string()
          .trim()
          .min(1)
          .max(18)
          .regex(/^[A-Za-z0-9]+$/)
          .describe("search_subsidiesが返したJグランツの補助金ID"),
        corporate_number: z
          .string()
          .trim()
          .regex(/^\d{13}$/)
          .describe("経済産業省の法人情報データベースで企業を特定する13桁の法人番号"),
        business_plans: z
          .array(z.string().trim().min(1).max(255))
          .max(20)
          .optional()
          .describe("補助金との照合に使う任意の事業計画"),
        location: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe("利用者が確認した現在の所在地。指定時は公開法人情報より優先"),
        industry: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .optional()
          .describe("利用者が確認した現在の業種。指定時は公開法人情報より優先"),
        employee_count: z
          .number()
          .int()
          .min(0)
          .max(10_000_000)
          .optional()
          .describe("利用者が確認した現在の従業員数。指定時は公開法人情報より優先"),
        capital_yen: z
          .number()
          .int()
          .min(0)
          .max(100_000_000_000_000)
          .optional()
          .describe("利用者が確認した現在の資本金（円）。指定時は公開法人情報より優先"),
      },
    },
    async ({
      subsidy_id,
      corporate_number,
      business_plans,
      location,
      industry,
      employee_count,
      capital_yen,
    }) => {
      try {
        return jsonToolResult(
          await evaluateSubsidyFitForCompany(
            subsidy_id,
            corporate_number,
            env.GBIZINFO_API_TOKEN,
            business_plans,
            {
              location,
              industry,
              employeeCount: employee_count,
              capitalYen: capital_yen,
            },
            jGrantsCacheOptions,
          ),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );
  server.registerTool(
    "search_subsidies",
    {
      description:
        "Jグランツの公開APIから補助金候補を検索します。所在地が指定された場合は全国対象制度も含めます。検索結果だけで対象可否を断定せず、候補選定後にget_subsidy_detailを使用してください。",
      inputSchema: {
        keyword: z
          .string()
          .trim()
          .min(2)
          .max(255)
          .describe("事業や投資目的を表す2〜255文字の検索語"),
        use_purpose: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .optional()
          .describe("Jグランツの利用目的区分"),
        target_area: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe("事業実施地域または所在地。例: 東京都"),
        industry: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .optional()
          .describe("Jグランツの業種区分。例: 製造業"),
        employee_count: z
          .number()
          .int()
          .min(0)
          .max(10_000_000)
          .optional()
          .describe("現在の従業員数。API取得後の候補絞り込みに使用"),
        accepting_only: z
          .boolean()
          .optional()
          .default(true)
          .describe("trueの場合、現在受付中の制度だけを返す"),
        sort: z
          .enum([
            "created_date",
            "acceptance_start_datetime",
            "acceptance_end_datetime",
          ])
          .optional()
          .default("acceptance_end_datetime"),
        order: z.enum(["ASC", "DESC"]).optional().default("ASC"),
        limit: z.number().int().min(1).max(50).optional().default(10),
      },
    },
    async ({
      keyword,
      use_purpose,
      target_area,
      industry,
      employee_count,
      accepting_only,
      sort,
      order,
      limit,
    }) => {
      try {
        return jsonToolResult(
          await searchSubsidies(
            {
              keyword,
              usePurpose: use_purpose,
              targetArea: target_area,
              industry,
              employeeCount: employee_count,
              acceptingOnly: accepting_only,
              sort,
              order,
              limit,
            },
            jGrantsCacheOptions,
          ),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );

  server.registerTool(
    "get_subsidy_detail",
    {
      description:
        "search_subsidiesが返した補助金IDからJグランツ詳細API V2を取得します。公募回ごとの受付期間と文書メタデータを返し、Base64文書本体は返しません。",
      inputSchema: {
        subsidy_id: z
          .string()
          .trim()
          .min(1)
          .max(18)
          .regex(/^[A-Za-z0-9]+$/)
          .describe("Jグランツの補助金ID（18文字以内の英数字）"),
      },
    },
    async ({ subsidy_id }) => {
      try {
        return jsonToolResult(
          await getSubsidyDetail(subsidy_id, jGrantsCacheOptions),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );

  server.registerTool(
    "evaluate_subsidy_fit",
    {
      description:
        "指定した補助金のJグランツ詳細と企業プロフィールを照合し、明示的な一致、不一致、未確認事項を分けて返します。assessment.statusは内部処理用です。利用者向け回答にはstrong_candidate、needs_confirmation、potentially_ineligible、insufficient_informationなどの英語コードを表示せず、statusLabelとsummaryを使って自然な日本語で説明してください。受給資格や採択を断定するツールではありません。",
      inputSchema: {
        subsidy_id: z
          .string()
          .trim()
          .min(1)
          .max(18)
          .regex(/^[A-Za-z0-9]+$/)
          .describe("search_subsidiesが返したJグランツの補助金ID"),
        company_profile: z.object({
          location: z.string().trim().min(1).max(100).optional(),
          industry: z.string().trim().min(1).max(255).optional(),
          employee_count: z.number().int().min(0).max(10_000_000).optional(),
          capital_yen: z
            .number()
            .int()
            .min(0)
            .max(100_000_000_000_000)
            .optional(),
          business_plans: z
            .array(z.string().trim().min(1).max(255))
            .max(20)
            .optional(),
        }),
      },
    },
    async ({ subsidy_id, company_profile }) => {
      try {
        return jsonToolResult(
          await evaluateSubsidyFit(
            subsidy_id,
            {
              location: company_profile.location,
              industry: company_profile.industry,
              employeeCount: company_profile.employee_count,
              capitalYen: company_profile.capital_yen,
              businessPlans: company_profile.business_plans,
            },
            jGrantsCacheOptions,
          ),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );

  return server;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: SERVER_NAME,
        version: SERVER_VERSION,
        mcpEndpoint: "/mcp",
      });
    }

    if (url.pathname === "/mcp") {
      const handleMcpRequest = createMcpHandler(() => createServer(env));
      return handleMcpRequest(request, env, ctx);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
