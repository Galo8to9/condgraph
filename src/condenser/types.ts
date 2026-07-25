import "dotenv/config";
import { GraphQLClient } from "graphql-request";
import { getIntrospectionQuery, type IntrospectionQuery } from "graphql";

const API_KEY = process.env.GRAPH_API_KEY;
if (!API_KEY) throw new Error("Set GRAPH_API_KEY in .env");

const gatewayUrl = (subgraphId: string) =>
  `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${subgraphId}`;

export async function fetchIntrospection(
  subgraphId: string,
): Promise<IntrospectionQuery> {
  const client = new GraphQLClient(gatewayUrl(subgraphId));
  return client.request<IntrospectionQuery>(getIntrospectionQuery());
}

export function gatewayUrlFor(subgraphId: string): string {
  return gatewayUrl(subgraphId);
}

export async function executeQuery(
  subgraphId: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const client = new GraphQLClient(gatewayUrl(subgraphId));
  return client.request(query, variables ?? {});
}
