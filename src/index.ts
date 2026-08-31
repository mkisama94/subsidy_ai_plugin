import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const SERVER_NAME = "subsidy-ai-mcp";
const SERVER_VERSION = "0.1.0";

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "hello",
    {
      description: "MCPサーバーの疎通確認用ツールです。指定された名前へ挨拶を返します。",
      inputSchema: {
        name: z.string().trim().min(1).max(100).optional(),
      },
    },
    async ({ name }) => ({
      content: [
        {
          type: "text",
          text: `こんにちは、${name ?? "世界"}。補助金AI MCPサーバーは正常に動作しています。`,
        },
      ],
    }),
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
