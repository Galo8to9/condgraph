import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { GraphQLClient } from "graphql-request";
import {
  getIntrospectionQuery,
  buildClientSchema,
  printSchema,
  type IntrospectionQuery,
} from "graphql";
import { encode } from "gpt-tokenizer";

const API_KEY = process.env.GRAPH_API_KEY;
if (!API_KEY) throw new Error("Set GRAPH_API_KEY in .env");

// Uniswap V3 on Ethereum mainnet — from the spec
const SUBGRAPHS: Record<string, string> = {
  "uniswap-v3": "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
};

const gatewayUrl = (id: string) =>
  `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${id}`;

function countTokens(s: string): number {
  return encode(s).length;
}

async function measure(name: string, id: string) {
  console.log(`\n=== ${name} (${id}) ===`);
  const client = new GraphQLClient(gatewayUrl(id));

  // 1. Raw introspection JSON — what the official MCP effectively returns
  const introspection = await client.request<IntrospectionQuery>(
    getIntrospectionQuery(),
  );
  const rawJson = JSON.stringify(introspection);
  const prettyJson = JSON.stringify(introspection, null, 2);

  // 2. SDL rendering — the strongest counter-baseline
  const schema = buildClientSchema(introspection);
  const sdl = printSchema(schema);

  // Save artifacts so the condenser has fixtures to work against
  mkdirSync("data", { recursive: true });
  writeFileSync(`data/${name}.introspection.json`, prettyJson);
  writeFileSync(`data/${name}.sdl.graphql`, sdl);

  const rawTokens = countTokens(rawJson);
  const sdlTokens = countTokens(sdl);

  console.log(`raw JSON tokens : ${rawTokens.toLocaleString()}`);
  console.log(`SDL tokens      : ${sdlTokens.toLocaleString()}`);
  console.log(`JSON bytes      : ${rawJson.length.toLocaleString()}`);
  console.log(`SDL bytes       : ${sdl.length.toLocaleString()}`);
  console.log(`types in schema : ${introspection.__schema.types.length}`);
}

for (const [name, id] of Object.entries(SUBGRAPHS)) {
  await measure(name, id);
}
