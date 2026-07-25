import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { encode } from "gpt-tokenizer";
import type { IntrospectionQuery } from "graphql";
import { condense, renderDigest } from "../src/condenser/index.js";
import { summarize } from "../stats.js";

const FIXTURES_DIR = "data/fixtures";
const DIGESTS_DIR = "data/digests";
const tok = (s: string) => encode(s).length;

interface Row {
  name: string;
  typesInSchema: number;
  typesKept: number;
  entities: number;
  enums: number;
  scalars: number;
  rawTokens: number; // minified introspection JSON — the real wire cost
  sdlTokens: number; // charitable baseline
  digestTokens: number; // the condenser output
}

function allFixtureNames(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".introspection.json"))
    .map((f) => f.replace(/\.introspection\.json$/, ""))
    .sort();
}

function loadSdlTokens(name: string): number | null {
  try {
    return tok(readFileSync(join(FIXTURES_DIR, `${name}.sdl.graphql`), "utf8"));
  } catch {
    return null; // sdl fixture missing; fall back gracefully
  }
}

function processFixture(name: string): Row {
  const introspection = JSON.parse(
    readFileSync(join(FIXTURES_DIR, `${name}.introspection.json`), "utf8"),
  ) as IntrospectionQuery;

  const digest = condense(introspection);
  const rendered = renderDigest(digest);

  mkdirSync(DIGESTS_DIR, { recursive: true });
  writeFileSync(join(DIGESTS_DIR, `${name}.digest.graphql`), rendered);

  return {
    name,
    typesInSchema: digest.stats.typesInSchema,
    typesKept: digest.stats.typesKept,
    entities: digest.entities.length,
    enums: digest.enums.length,
    scalars: digest.scalars.length,
    rawTokens: tok(JSON.stringify(introspection)),
    sdlTokens: loadSdlTokens(name) ?? 0,
    digestTokens: tok(rendered),
  };
}

// ---------- pretty printing (mirrors measure.ts) ----------

const num = (n: number) => n.toLocaleString();
const ratio = (a: number, b: number) => (a / b).toFixed(1) + "x";
const pct = (from: number, to: number) =>
  ((1 - to / from) * 100).toFixed(1) + "%";

function printBlock(index: number, total: number, r: Row): void {
  const header = `[${index}/${total}] ${r.name}`;
  console.log("\n" + header);
  console.log("─".repeat(Math.max(header.length, 40)));
  console.log(
    `  types in schema     : ${String(r.typesInSchema).padStart(7)}   (before condensing)`,
  );
  console.log(
    `  types kept          : ${String(r.typesKept).padStart(7)}   (entities + enums + scalars)`,
  );
  console.log(
    `  types dropped       : ${String(r.typesInSchema - r.typesKept).padStart(7)}   (_filter, _orderBy, meta, roots)`,
  );
  console.log(`  entities / enums    : ${r.entities} / ${r.enums}`);
  console.log(`  custom scalars      : ${r.scalars}`);
  console.log(
    `  raw JSON tokens     : ${num(r.rawTokens).padStart(9)}   (the naive MCP wire cost)`,
  );
  if (r.sdlTokens > 0)
    console.log(
      `  SDL tokens          : ${num(r.sdlTokens).padStart(9)}   (charitable baseline)`,
    );
  console.log(
    `  digest tokens       : ${num(r.digestTokens).padStart(9)}   (what the model actually reads)`,
  );
  console.log(
    `  reduction vs raw    : ${ratio(r.rawTokens, r.digestTokens).padStart(7)}   (${pct(r.rawTokens, r.digestTokens)} smaller)`,
  );
  if (r.sdlTokens > 0)
    console.log(
      `  reduction vs SDL    : ${ratio(r.sdlTokens, r.digestTokens).padStart(7)}   (${pct(r.sdlTokens, r.digestTokens)} smaller)`,
    );
}

function drawTable(title: string, headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const border = (l: string, m: string, r: string) =>
    l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
  const dataRow = (cells: string[]) =>
    "│ " + cells.map((c, i) => c.padStart(widths[i])).join(" │ ") + " │";
  const headerRow =
    "│ " + headers.map((h, i) => h.padEnd(widths[i])).join(" │ ") + " │";

  console.log("\n" + title);
  console.log(border("┌", "┬", "┐"));
  console.log(headerRow);
  console.log(border("├", "┼", "┤"));
  for (const r of rows) console.log(dataRow(r));
  console.log(border("└", "┴", "┘"));
}

function drawSummary(title: string, entries: [string, string][]): void {
  const keyW = Math.max(...entries.map(([k]) => k.length));
  const valW = Math.max(...entries.map(([, v]) => v.length));
  const total = keyW + valW + 5;
  console.log("\n" + title);
  console.log("┌" + "─".repeat(total) + "┐");
  for (const [k, v] of entries)
    console.log(`│ ${k.padEnd(keyW)}   ${v.padStart(valW)} │`);
  console.log("└" + "─".repeat(total) + "┘");
}

function printFinal(rows: Row[]): void {
  const sorted = [...rows].sort((a, b) => b.rawTokens - a.rawTokens);

  drawTable(
    "Condenser reduction (raw JSON → condensed digest), sorted by raw token cost",
    ["subgraph", "raw tok", "digest", "vs raw", "vs SDL", "entities"],
    sorted.map((r) => [
      r.name,
      num(r.rawTokens),
      num(r.digestTokens),
      ratio(r.rawTokens, r.digestTokens),
      r.sdlTokens > 0 ? ratio(r.sdlTokens, r.digestTokens) : "—",
      String(r.entities),
    ]),
  );

  const vsRaw = rows.map((r) => r.rawTokens / r.digestTokens);
  const s = summarize(vsRaw);
  const sumRaw = rows.reduce((a, r) => a + r.rawTokens, 0);
  const sumDigest = rows.reduce((a, r) => a + r.digestTokens, 0);

  drawSummary(
    "Aggregate reduction  (raw introspection JSON → condensed digest)",
    [
      ["subgraphs condensed", String(s.n)],
      ["mean per-subgraph reduction", s.mean.toFixed(1) + "x"],
      ["median reduction", s.median.toFixed(1) + "x"],
      ["min / max reduction", `${s.min.toFixed(1)}x / ${s.max.toFixed(1)}x`],
      ["sample stdev of reduction", s.stdev.toFixed(2)],
      [
        "aggregate reduction (Σraw / Σdigest)",
        (sumRaw / sumDigest).toFixed(1) + "x",
      ],
      ["total tokens raw → digest", `${num(sumRaw)} → ${num(sumDigest)}`],
    ],
  );
}

function toMarkdown(rows: Row[]): string {
  const sorted = [...rows].sort((a, b) => b.rawTokens - a.rawTokens);
  const head =
    "| Subgraph | Raw JSON (tok) | Digest (tok) | vs raw | vs SDL | Entities |\n" +
    "| --- | ---: | ---: | ---: | ---: | ---: |\n";
  const body = sorted
    .map(
      (r) =>
        `| ${r.name} | ${num(r.rawTokens)} | ${num(r.digestTokens)} | ${ratio(r.rawTokens, r.digestTokens)} | ${r.sdlTokens > 0 ? ratio(r.sdlTokens, r.digestTokens) : "—"} | ${r.entities} |`,
    )
    .join("\n");
  return `_Raw introspection JSON vs. condensed digest. Measured with gpt-tokenizer (cl100k_base) as a proxy; reproduce with \`npm run condense\`._\n\n${head}${body}\n`;
}

// ---------- main ----------

function main() {
  const names = allFixtureNames();
  if (names.length === 0) {
    console.error(
      `No fixtures in ${FIXTURES_DIR}. Run \`npm run measure\` first.`,
    );
    process.exit(1);
  }

  console.log(`Condensing ${names.length} fixture(s)...`);
  const rows: Row[] = [];
  for (let i = 0; i < names.length; i++) {
    const row = processFixture(names[i]);
    rows.push(row);
    printBlock(i + 1, names.length, row);
  }

  mkdirSync("data", { recursive: true });
  writeFileSync("data/condense-results.json", JSON.stringify(rows, null, 2));
  writeFileSync("data/condense-results.md", toMarkdown(rows));

  printFinal(rows);
  console.log(
    "\nWrote data/condense-results.json and data/condense-results.md",
  );
  console.log(`Digests in ${DIGESTS_DIR}/`);
}

main();
