import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { GraphQLClient } from "graphql-request";
import {
  getIntrospectionQuery,
  buildClientSchema,
  printSchema,
  type IntrospectionQuery,
} from "graphql";
import { encode } from "gpt-tokenizer";
import { summarize } from "../stats.js";

const API_KEY = process.env.GRAPH_API_KEY;
if (!API_KEY) throw new Error("Set GRAPH_API_KEY in .env");

const SUBGRAPHS: Record<string, string> = JSON.parse(
  readFileSync("./subgraphs.json", "utf8"),
);

const REQUEST_TIMEOUT_MS = 30_000;
const gatewayUrl = (id: string) =>
  `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${id}`;
const tok = (s: string) => encode(s).length;

interface Row {
  name: string;
  id: string;
  status: "ok" | "error";
  rawTokens?: number;
  sdlTokens?: number;
  rawBytes?: number;
  sdlBytes?: number;
  types?: number;
  error?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function measureOne(name: string, id: string): Promise<Row> {
  const client = new GraphQLClient(gatewayUrl(id));
  const introspection = await withTimeout(
    client.request<IntrospectionQuery>(getIntrospectionQuery()),
    REQUEST_TIMEOUT_MS,
  );
  const rawJson = JSON.stringify(introspection);
  const sdl = printSchema(buildClientSchema(introspection));

  mkdirSync("data/fixtures", { recursive: true });
  writeFileSync(
    `data/fixtures/${name}.introspection.json`,
    JSON.stringify(introspection, null, 2),
  );
  writeFileSync(`data/fixtures/${name}.sdl.graphql`, sdl);

  return {
    name,
    id,
    status: "ok",
    rawTokens: tok(rawJson),
    sdlTokens: tok(sdl),
    rawBytes: Buffer.byteLength(rawJson),
    sdlBytes: Buffer.byteLength(sdl),
    types: introspection.__schema.types.length,
  };
}

// ---------- pretty printing ----------

const num = (n: number) => n.toLocaleString();
const pct = (from: number, to: number) =>
  ((1 - to / from) * 100).toFixed(1) + "%";

function printBlock(index: number, total: number, r: Row): void {
  const header = `[${index}/${total}] ${r.name} (${r.id})`;
  console.log("\n" + header);
  console.log("─".repeat(header.length));

  if (r.status === "error") {
    console.log(`  status              : FAILED`);
    console.log(
      `  reason              : ${r.error?.split("\n")[0].slice(0, 100)}`,
    );
    return;
  }

  const ratio = r.rawTokens! / r.sdlTokens!;
  console.log(`  status              : ok`);
  console.log(
    `  types in schema     : ${r.types}   (entity + generated types combined)`,
  );
  console.log(
    `  raw JSON tokens     : ${num(r.rawTokens!).padStart(9)}   (what the naive MCP path costs)`,
  );
  console.log(
    `  SDL tokens          : ${num(r.sdlTokens!).padStart(9)}   (charitable baseline; still includes _filter/_orderBy)`,
  );
  console.log(`  JSON bytes          : ${num(r.rawBytes!).padStart(9)}`);
  console.log(`  SDL bytes           : ${num(r.sdlBytes!).padStart(9)}`);
  console.log(
    `  raw -> SDL ratio    : ${ratio.toFixed(2)}x  (${pct(r.rawTokens!, r.sdlTokens!)} smaller by tokens)`,
  );
}

function drawTable(title: string, headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (l: string, m: string, r: string) =>
    l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
  const row = (cells: string[]) =>
    "│ " + cells.map((c, i) => c.padStart(widths[i])).join(" │ ") + " │";
  const headerRow =
    "│ " + headers.map((h, i) => h.padEnd(widths[i])).join(" │ ") + " │";

  console.log("\n" + title);
  console.log(line("┌", "┬", "┐"));
  console.log(headerRow);
  console.log(line("├", "┼", "┤"));
  for (const r of rows) console.log(row(r));
  console.log(line("└", "┴", "┘"));
}

function drawSummary(title: string, entries: [string, string][]): void {
  const keyW = Math.max(...entries.map(([k]) => k.length));
  const valW = Math.max(...entries.map(([, v]) => v.length));
  const total = keyW + valW + 5;

  console.log("\n" + title);
  console.log("┌" + "─".repeat(total) + "┐");
  for (const [k, v] of entries) {
    console.log(`│ ${k.padEnd(keyW)}   ${v.padStart(valW)} │`);
  }
  console.log("└" + "─".repeat(total) + "┘");
}

function printFinal(rows: Row[]): void {
  const ok = rows
    .filter((r) => r.status === "ok")
    .sort((a, b) => (b.rawTokens ?? 0) - (a.rawTokens ?? 0));
  const failed = rows.filter((r) => r.status === "error");

  drawTable(
    "Per-subgraph reduction (raw JSON → SDL), sorted by raw token cost",
    ["subgraph", "raw tok", "SDL tok", "ratio", "reduction", "types"],
    ok.map((r) => [
      r.name,
      num(r.rawTokens!),
      num(r.sdlTokens!),
      (r.rawTokens! / r.sdlTokens!).toFixed(2) + "x",
      pct(r.rawTokens!, r.sdlTokens!),
      String(r.types),
    ]),
  );

  const ratios = ok.map((r) => r.rawTokens! / r.sdlTokens!);
  const s = summarize(ratios);
  const sumRaw = ok.reduce((a, r) => a + r.rawTokens!, 0);
  const sumSdl = ok.reduce((a, r) => a + r.sdlTokens!, 0);

  drawSummary(
    "Aggregate stats  (baseline only — condenser numbers come from `npm run condense`)",
    [
      ["subgraphs measured", `${s.n} ok, ${failed.length} failed`],
      ["mean per-subgraph ratio", s.mean.toFixed(2) + "x"],
      ["median ratio", s.median.toFixed(2) + "x"],
      ["min / max ratio", `${s.min.toFixed(2)}x / ${s.max.toFixed(2)}x`],
      ["sample stdev of ratio", s.stdev.toFixed(3)],
      ["aggregate ratio (Σraw / Σsdl)", (sumRaw / sumSdl).toFixed(2) + "x"],
      ["total tokens raw → sdl", `${num(sumRaw)} → ${num(sumSdl)}`],
    ],
  );

  if (failed.length > 0) {
    console.log("\nFailed subgraphs:");
    for (const r of failed) {
      console.log(`  · ${r.name}  (${r.id})`);
      console.log(`      ${r.error?.split("\n")[0].slice(0, 100)}`);
    }
  }
}

// ---------- markdown (unchanged shape, still emits the results file) ----------

function toMarkdown(rows: Row[]): string {
  const ok = rows
    .filter((r) => r.status === "ok")
    .sort((a, b) => (b.rawTokens ?? 0) - (a.rawTokens ?? 0));
  const head =
    "| Subgraph | Raw (tok) | SDL (tok) | Ratio | Reduction | Types |\n" +
    "| --- | ---: | ---: | ---: | ---: | ---: |\n";
  const body = ok
    .map(
      (r) =>
        `| ${r.name} | ${num(r.rawTokens!)} | ${num(r.sdlTokens!)} | ${(r.rawTokens! / r.sdlTokens!).toFixed(2)}x | ${pct(r.rawTokens!, r.sdlTokens!)} | ${r.types} |`,
    )
    .join("\n");
  return `_Raw introspection JSON vs. SDL rendering. Baseline only — not the condenser's reduction._\n\n${head}${body}\n`;
}

// ---------- main ----------

async function main() {
  const entries = Object.entries(SUBGRAPHS);
  console.log(`Measuring ${entries.length} subgraph(s)...`);

  const rows: Row[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [name, id] = entries[i];
    try {
      const row = await measureOne(name, id);
      rows.push(row);
      printBlock(i + 1, entries.length, row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const row: Row = { name, id, status: "error", error: msg };
      rows.push(row);
      printBlock(i + 1, entries.length, row);
    }
  }

  mkdirSync("data", { recursive: true });
  writeFileSync("data/measure-results.json", JSON.stringify(rows, null, 2));
  writeFileSync("data/measure-results.md", toMarkdown(rows));

  printFinal(rows);
  console.log("\nWrote data/measure-results.json and data/measure-results.md");
}

main();
