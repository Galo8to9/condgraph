import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IntrospectionQuery } from "graphql";
import { condense, renderDigest } from "../src/condenser/index.js";

// Minimal hand-crafted introspection covering the drop rules.
const tinyIntrospection: IntrospectionQuery = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: null,
    subscriptionType: null,
    directives: [],
    types: [
      {
        kind: "OBJECT",
        name: "Pool",
        description: "A liquidity pool",
        fields: [
          {
            name: "id",
            description: null,
            args: [],
            type: {
              kind: "NON_NULL",
              ofType: { kind: "SCALAR", name: "ID", ofType: null },
            },
            isDeprecated: false,
            deprecationReason: null,
          },
          {
            name: "totalValueLockedUSD",
            description: "TVL in USD",
            args: [],
            type: {
              kind: "NON_NULL",
              ofType: { kind: "SCALAR", name: "BigDecimal", ofType: null },
            },
            isDeprecated: false,
            deprecationReason: null,
          },
          {
            name: "swaps",
            description: null,
            args: [],
            type: {
              kind: "NON_NULL",
              ofType: {
                kind: "LIST",
                ofType: {
                  kind: "NON_NULL",
                  ofType: { kind: "OBJECT", name: "Swap", ofType: null },
                },
              },
            },
            isDeprecated: false,
            deprecationReason: null,
          },
        ],
        inputFields: null,
        interfaces: [],
        enumValues: null,
        possibleTypes: null,
      },
      {
        kind: "OBJECT",
        name: "Swap",
        description: null,
        fields: [
          {
            name: "id",
            description: null,
            args: [],
            type: {
              kind: "NON_NULL",
              ofType: { kind: "SCALAR", name: "ID", ofType: null },
            },
            isDeprecated: false,
            deprecationReason: null,
          },
        ],
        inputFields: null,
        interfaces: [],
        enumValues: null,
        possibleTypes: null,
      },
      // Boilerplate that must be dropped:
      {
        kind: "INPUT_OBJECT",
        name: "Pool_filter",
        description: null,
        fields: null,
        inputFields: [],
        interfaces: null,
        enumValues: null,
        possibleTypes: null,
      } as any,
      {
        kind: "ENUM",
        name: "Pool_orderBy",
        description: null,
        fields: null,
        inputFields: null,
        interfaces: null,
        enumValues: [
          {
            name: "id",
            isDeprecated: false,
            deprecationReason: null,
            description: null,
          },
        ],
        possibleTypes: null,
      } as any,
      {
        kind: "ENUM",
        name: "OrderDirection",
        description: null,
        fields: null,
        inputFields: null,
        interfaces: null,
        enumValues: [
          {
            name: "asc",
            isDeprecated: false,
            deprecationReason: null,
            description: null,
          },
        ],
        possibleTypes: null,
      } as any,
      {
        kind: "OBJECT",
        name: "_Meta_",
        description: null,
        fields: [],
        inputFields: null,
        interfaces: [],
        enumValues: null,
        possibleTypes: null,
      } as any,
      {
        kind: "SCALAR",
        name: "BigDecimal",
        description: null,
        fields: null,
        inputFields: null,
        interfaces: null,
        enumValues: null,
        possibleTypes: null,
      } as any,
      {
        kind: "SCALAR",
        name: "String",
        description: null,
        fields: null,
        inputFields: null,
        interfaces: null,
        enumValues: null,
        possibleTypes: null,
      } as any,
      // Root Query, always dropped.
      {
        kind: "OBJECT",
        name: "Query",
        description: null,
        fields: [],
        inputFields: null,
        interfaces: [],
        enumValues: null,
        possibleTypes: null,
      } as any,
    ],
  },
} as unknown as IntrospectionQuery;

// ---------- fixture helpers ----------

const FIXTURES_DIR = "data/fixtures";

function loadFixture(name: string): IntrospectionQuery {
  const raw = readFileSync(
    join(FIXTURES_DIR, `${name}.introspection.json`),
    "utf8",
  );
  return JSON.parse(raw) as IntrospectionQuery;
}

function allFixtureNames(): string[] {
  try {
    return readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".introspection.json"))
      .map((f) => f.replace(/\.introspection\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

// ---------- synthetic unit tests (specify the rules) ----------

describe("condense", () => {
  it("keeps entity types and drops filter/orderBy/meta/root", () => {
    const d = condense(tinyIntrospection);
    const names = d.entities.map((e) => e.name);
    expect(names).toEqual(["Pool", "Swap"]);
    expect(names).not.toContain("Query");
    expect(names).not.toContain("_Meta_");
  });

  it("drops OrderDirection and *_orderBy enums", () => {
    const d = condense(tinyIntrospection);
    expect(d.enums).toEqual([]);
  });

  it("keeps only referenced custom scalars", () => {
    const d = condense(tinyIntrospection);
    expect(d.scalars).toContain("BigDecimal");
    expect(d.scalars).not.toContain("String");
  });

  it("unwraps NonNull, List, NonNull correctly", () => {
    const d = condense(tinyIntrospection);
    const pool = d.entities.find((e) => e.name === "Pool")!;
    const swaps = pool.fields.find((f) => f.name === "swaps")!;
    expect(swaps.typeName).toBe("Swap");
    expect(swaps.isList).toBe(true);
    expect(swaps.isNonNull).toBe(true);
  });

  it("renders SDL-ish output with the header", () => {
    const out = renderDigest(condense(tinyIntrospection));
    expect(out).toContain("# Condensed subgraph schema");
    expect(out).toContain("type Pool {");
    expect(out).not.toContain("Pool_filter");
    expect(out).not.toContain("OrderDirection");
  });
});

// ---------- named real-fixture test (Uniswap V3 sanity check) ----------

describe("condense on real Uniswap V3 fixture", () => {
  it("produces a large reduction and drops all *_filter / *_orderBy", () => {
    const introspection = loadFixture("uniswap-v3");
    const digest = condense(introspection);
    const rendered = renderDigest(digest);

    expect(rendered).not.toMatch(/_filter\b/);
    expect(rendered).not.toMatch(/_orderBy\b/);
    expect(rendered).not.toContain("OrderDirection");
    expect(rendered).not.toContain("_Meta_");

    expect(rendered).toMatch(/type Pool \{/);
    expect(rendered).toMatch(/type Token \{/);
    expect(rendered).toMatch(/type Swap \{/);
  });
});

// ---------- broad invariants across every fixture ----------

describe("condense invariants across all real fixtures", () => {
  const names = allFixtureNames();

  if (names.length === 0) {
    it.skip("no fixtures found — run `npm run measure` first", () => {});
    return;
  }

  it.each(names)("%s: no boilerplate leaks into the digest", (name) => {
    const rendered = renderDigest(condense(loadFixture(name)));
    expect(rendered).not.toMatch(/\b\w+_filter\b/);
    expect(rendered).not.toMatch(/\b\w+_orderBy\b/);
    expect(rendered).not.toContain("OrderDirection");
    expect(rendered).not.toContain("_Meta_");
    expect(rendered).not.toMatch(/\b__\w+/);
  });

  it.each(names)(
    "%s: digest is non-trivial and shows real reduction",
    (name) => {
      const introspection = loadFixture(name);
      const digest = condense(introspection);
      const rendered = renderDigest(digest);

      expect(digest.entities.length).toBeGreaterThan(0);

      const rawSize = JSON.stringify(introspection).length;
      const digestSize = rendered.length;
      expect(rawSize / digestSize).toBeGreaterThan(10);
    },
  );
});
