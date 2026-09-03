import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { getSubsidyDetail, JGrantsApiError, searchSubsidies } from "./jgrants";
import { evaluateSubsidyFit } from "./matching";
import {
  GBizInfoApiError,
  getCompanyProfile,
  searchCompanies,
} from "./gbizinfo";
import { evaluateSubsidyFitForCompany } from "./companyMatching";

const SERVER_NAME = "subsidy-ai-mcp";
const SERVER_VERSION = "0.5.1";

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
    error instanceof JGrantsApiError || error instanceof GBizInfoApiError;
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

function createServer(gbizInfoApiToken?: string): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "search_companies",
    {
      description:
        "gBizINFOの公開APIで法人名を検索し、法人番号・所在地を含む候補を返します。同名法人など複数候補がある場合は自動決定せず、利用者に所在地や正式名称を確認してください。mayHaveMoreがtrueなら先頭ページだけであることを明示してください。statusAvailabilityがnot_providedの法人を登記中・存続中と断定しないでください。候補確定後はget_company_profileを使用します。",
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
            gbizInfoApiToken,
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
        "法人番号からgBizINFOの公開法人情報を取得します。所在地、業種、従業員数、資本金、認定情報、過去の補助金情報を返します。未登録項目は推測せずnullまたは空配列で返し、statusAvailabilityがnot_providedの場合は登記中・存続中と断定しません。",
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
          .describe("認定情報と補助金履歴の最大返却件数"),
      },
    },
    async ({ corporate_number, activity_limit }) => {
      try {
        return jsonToolResult(
          await getCompanyProfile(
            corporate_number,
            gbizInfoApiToken,
            activity_limit,
          ),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );

  server.registerTool(
    "evaluate_subsidy_fit_for_company",
    {
      description:
        "法人番号から取得したgBizINFOの企業プロフィールを、指定したJグランツ補助金の公開条件と照合します。gBizINFOで未登録または古い所在地、業種、従業員数、資本金は利用者の明示入力で補完でき、各値の出典と矛盾も返します。申請資格や採択を断定しません。",
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
          .describe("gBizINFOで企業情報を取得する13桁の法人番号"),
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
          .describe("利用者が確認した現在の所在地。指定時はgBizINFOより優先"),
        industry: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .optional()
          .describe("利用者が確認した現在の業種。指定時はgBizINFOより優先"),
        employee_count: z
          .number()
          .int()
          .min(0)
          .max(10_000_000)
          .optional()
          .describe("利用者が確認した現在の従業員数。指定時はgBizINFOより優先"),
        capital_yen: z
          .number()
          .int()
          .min(0)
          .max(100_000_000_000_000)
          .optional()
          .describe("利用者が確認した現在の資本金（円）。指定時はgBizINFOより優先"),
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
            gbizInfoApiToken,
            business_plans,
            {
              location,
              industry,
              employeeCount: employee_count,
              capitalYen: capital_yen,
            },
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
          await searchSubsidies({
            keyword,
            usePurpose: use_purpose,
            targetArea: target_area,
            industry,
            employeeCount: employee_count,
            acceptingOnly: accepting_only,
            sort,
            order,
            limit,
          }),
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
        return jsonToolResult(await getSubsidyDetail(subsidy_id));
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );

  server.registerTool(
    "evaluate_subsidy_fit",
    {
      description:
        "指定した補助金のJグランツ詳細と企業プロフィールを照合し、明示的な一致、不一致、未確認事項を分けて返します。受給資格や採択を断定するツールではありません。",
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
          await evaluateSubsidyFit(subsidy_id, {
            location: company_profile.location,
            industry: company_profile.industry,
            employeeCount: company_profile.employee_count,
            capitalYen: company_profile.capital_yen,
            businessPlans: company_profile.business_plans,
          }),
        );
      } catch (error) {
        return errorToolResult(error);
      }
    },
  );

  return server;
}

type Env = {
  GBIZINFO_API_TOKEN?: string;
};

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
      const handleMcpRequest = createMcpHandler(() =>
        createServer(env.GBIZINFO_API_TOKEN),
      );
      return handleMcpRequest(request, env, ctx);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
