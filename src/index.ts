import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import {
  getSubsidyDetail,
  JGrantsApiError,
  searchSubsidies,
} from "./jgrants";
import { evaluateSubsidyFit } from "./matching";

const SERVER_NAME = "subsidy-ai-mcp";
const SERVER_VERSION = "0.3.0";

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
  const known = error instanceof JGrantsApiError;
  const payload = {
    error: {
      code: known ? error.code : "internal_error",
      message: known
        ? error.message
        : "補助金情報の取得中に予期しないエラーが発生しました。",
      retryable: known
        ? error.code === "timeout" || error.code === "upstream_error"
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

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });


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
          employee_count: z
            .number()
            .int()
            .min(0)
            .max(10_000_000)
            .optional(),
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

const handleMcpRequest = createMcpHandler(createServer);

export default {
  async fetch(
    request: Request,
    env: unknown,
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
      return handleMcpRequest(request, env, ctx);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler;
