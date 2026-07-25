#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { encode } from "gpt-tokenizer";
import { fetchIntrospection, executeQuery } from "../gateway/client.js";
import { condense, renderDigest } from "../condenser/index.js";

const server = new Server(
  {
    name: "subgraph-schema-condenser",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_condensed_schema",
      description:
        "Fetch the GraphQL schema of a subgraph on The Graph Network and return a condensed digest containing only entities, fields, and relationships — with auto-generated filter/orderBy boilerplate stripped. Typical reduction: 50-100x fewer tokens than raw introspection. Use this instead of a full schema fetch when you need to write queries against a subgraph but do not need to see the generated filter input types (they follow standard subgraph conventions: field_gt, field_lt, field_in, field_contains, orderBy, orderDirection, first, skip).",
      inputSchema: {
        type: "object",
        properties: {
          subgraph_id: {
            type: "string",
            description:
              "The subgraph ID on The Graph Network (e.g. '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV' for Uniswap V3).",
          },
        },
        required: ["subgraph_id"],
      },
    },
    {
      name: "execute_query",
      description:
        "Execute a GraphQL query against a subgraph on The Graph Network and return the JSON result. Use this after get_condensed_schema to run a query you have written against the same subgraph.",
      inputSchema: {
        type: "object",
        properties: {
          subgraph_id: {
            type: "string",
            description: "The subgraph ID to query.",
          },
          query: {
            type: "string",
            description: "The GraphQL query string to execute.",
          },
          variables: {
            type: "object",
            description: "Optional variables object for the query.",
            additionalProperties: true,
          },
        },
        required: ["subgraph_id", "query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  if (req.params.name === "get_condensed_schema") {
    const subgraphId = args.subgraph_id;
    if (typeof subgraphId !== "string" || subgraphId.length === 0) {
      throw new Error("subgraph_id must be a non-empty string");
    }
    try {
      const introspection = await fetchIntrospection(subgraphId);
      const digest = condense(introspection);
      const rendered = renderDigest(digest);

      const rawTokens = encode(JSON.stringify(introspection)).length;
      const digestTokens = encode(rendered).length;
      const ratio = (rawTokens / digestTokens).toFixed(1);

      const header =
        `# Subgraph: ${subgraphId}\n` +
        `# Reduction: ${rawTokens.toLocaleString()} -> ${digestTokens.toLocaleString()} tokens (${ratio}x)\n` +
        `# Kept ${digest.stats.typesKept} of ${digest.stats.typesInSchema} types.\n\n`;

      return { content: [{ type: "text", text: header + rendered }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error fetching schema: ${msg}` }],
        isError: true,
      };
    }
  }

  if (req.params.name === "execute_query") {
    const subgraphId = args.subgraph_id;
    const query = args.query;
    const variables = args.variables as Record<string, unknown> | undefined;

    if (typeof subgraphId !== "string" || subgraphId.length === 0) {
      throw new Error("subgraph_id must be a non-empty string");
    }
    if (typeof query !== "string" || query.length === 0) {
      throw new Error("query must be a non-empty string");
    }
    try {
      const result = await executeQuery(subgraphId, query, variables);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Query error: ${msg}` }],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${req.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is fine; stdout is reserved for JSON-RPC on stdio transports.
  console.error("subgraph-schema-condenser MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
