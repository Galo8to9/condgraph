# Subgraph Schema Condenser

**An MCP server that turns GraphQL introspection output into a compact, query-sufficient schema digest.**

Built for ETHGlobal Lisbon 2026 · The Graph "Best AI Tooling" track.

Measured across 30 live subgraphs on The Graph Network: **5,337,846 tokens of raw introspection reduced to 177,728 tokens of digest** — a 30x aggregate reduction, with every entity, field, relationship, and domain enum preserved.

---

## The problem

When an AI agent wants to query a subgraph, it first has to learn the schema. There are two ways to get one, and they cost wildly different amounts of context.

The cheap path is to read the authored `schema.graphql` straight from the deployment manifest. It's the file the subgraph developer actually wrote — entities, fields, a few directives, and nothing else. The Graph's official Subgraph MCP takes this path: `get_schema_by_subgraph_id` queries the network subgraph for `manifest { schema { schema } }` and hands back the source file. If your subgraph is published to The Graph Network and you're using the official server, you are already on the cheap path, and you don't need this tool. That's worth saying plainly up front.

The other path is **GraphQL introspection**, and it is the *only* path available when there is no network manifest to read: a self-hosted graph-node, a Subgraph Studio development endpoint, an unpublished or locally-deployed subgraph, a private indexer, or any GraphQL API that isn't a subgraph at all. In those cases the agent has an HTTP endpoint and nothing else, so it sends the standard introspection query and receives whatever comes back.

What comes back is enormous. graph-node auto-generates, for every entity in the schema:

- a `*_filter` input type carrying a `_gt` / `_lt` / `_gte` / `_lte` / `_in` / `_not` / `_contains` / `_starts_with` variant for **every field**
- a `*_orderBy` enum listing **every field** of that entity
- block-height, pagination, and `_Meta_` scaffolding repeated throughout

For the Uniswap V3 subgraph, 23 entities expand into 83 introspection types and 161,647 tokens of JSON. For Aave V2 on Ethereum, 29 entities become 125 types and 323,136 tokens. That is what an introspection-based agent pays, per subgraph, before it has written a single line of query.

The cost isn't only money and latency. It's attention. A model spending 300,000 tokens parsing filter permutations is a model that is not thinking about the data model.

## The insight

The model never needed to be told that `Pool` has a `totalValueLockedUSD_gt` filter.

Filters and ordering in subgraph GraphQL follow completely mechanical rules. Given a field name, any competent model can derive `field_gt`, `field_in`, `field_contains`, `orderBy: field`, `orderDirection: desc` without being shown a single generated type. The generated machinery is 90–98% of the introspection payload and roughly 0% of the information.

So the condenser strips all of it and replaces it with a nine-line convention header that states the rules once, at the top of the digest, instead of enumerating their expansion thousands of times.

What survives is what actually carries information: entity names, field names and types, relationships between entities, domain enums, referenced custom scalars, and any documentation the schema author wrote.

## What it does

The server exposes two tools.

**`get_condensed_schema(subgraph_id)`** fetches introspection from The Graph's gateway, condenses it, and returns SDL-shaped text prefixed with a token accounting header showing the before/after for that specific call.

**`execute_query(subgraph_id, query, variables?)`** runs a query against the same gateway, so the server is self-contained: an agent can go from "I know nothing about this subgraph" to real on-chain data without any other tool.

A condensed digest looks like this:

```graphql
# Condensed subgraph schema.
# Filters and ordering follow standard subgraph conventions and are omitted here:
#   where: { <field>: value, <field>_gt: value, <field>_lt: value,
#            <field>_gte: value, <field>_lte: value, <field>_in: [values],
#            <field>_not: value, <field>_contains: substring, ... }
#   orderBy: <any field on the entity>
#   orderDirection: asc | desc
#   first: <n>   skip: <n>   block: { number: <n> }
# Apply these to any list query on the entities below.

scalar BigDecimal
scalar BigInt
scalar Bytes

type Pool {
  id: ID!
  token0: Token!
  token1: Token!
  totalValueLockedUSD: BigDecimal!
  swaps: [Swap!]!
}
```

That's the whole idea. It is deterministic filtering over a JSON type system — no embeddings, no vector store, no similarity search, nothing that can't be unit-tested with an assertion.

---

## Measured results

Every number below comes from a live fetch against The Graph's gateway. Nothing is mocked, nothing is estimated. Reproduce the whole table with `npm run measure && npm run condense`.

**30 subgraph IDs fetched, 30 succeeded, 0 failures.** Those 30 IDs span **25 distinct schemas** — several Aave and Compound deployments share the Messari standardized schema across versions and chains, and PancakeSwap V3 is a Uniswap V3 fork, so a handful of rows are byte-identical to each other. They're marked below. Deduplicating them moves the aggregate from 30.0x to 31.7x, so nothing here depends on the duplicates being counted twice.

| Subgraph | Raw JSON (tok) | SDL (tok) | Digest (tok) | vs raw | vs SDL | Entities |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gmx-avalanche | 332,998 | 92,864 | 13,728 | 24.3x | 6.8x | 25 |
| aave-v2-ethereum ᵃ | 323,136 | 89,335 | 12,960 | 24.9x | 6.9x | 29 |
| aave-v3-base ᵃ | 323,136 | 89,335 | 12,960 | 24.9x | 6.9x | 29 |
| aave-v2-polygon ᵇ | 321,442 | 88,951 | 12,971 | 24.8x | 6.9x | 29 |
| aave-v3-ethereum ᵇ | 321,442 | 88,951 | 12,971 | 24.8x | 6.9x | 29 |
| aave-v3-optimism ᵇ | 321,442 | 88,951 | 12,971 | 24.8x | 6.9x | 29 |
| compound-v3-ethereum | 309,031 | 84,981 | 12,618 | 24.5x | 6.7x | 27 |
| compound-v3-base | 246,045 | 68,870 | 7,285 | 33.8x | 9.5x | 40 |
| compound-v3-polygon | 245,684 | 68,833 | 7,297 | 33.7x | 9.4x | 40 |
| pancakeswap-v3-ethereum ᶜ | 221,057 | 61,512 | 9,839 | 22.5x | 6.3x | 24 |
| uniswap-v3-base-alt ᶜ | 221,057 | 61,512 | 9,839 | 22.5x | 6.3x | 24 |
| sushiswap-v3-ethereum | 221,031 | 61,510 | 9,835 | 22.5x | 6.3x | 24 |
| makerdao-protofire | 168,079 | 45,434 | 4,281 | 39.3x | 10.6x | 30 |
| balancer-optimism-v2 | 167,132 | 44,316 | 2,134 | **78.3x** | 20.8x | 26 |
| uniswap-v3-polygon-alt | 162,122 | 40,745 | 2,240 | 72.4x | 18.2x | 20 |
| uniswap-v3 | 161,647 | 40,966 | 2,553 | 63.3x | 16.0x | 23 |
| curve-finance-ethereum | 140,469 | 40,289 | 5,610 | 25.0x | 7.2x | 18 |
| ens-subgraph-v1 | 123,704 | 35,068 | 3,455 | 35.8x | 10.1x | 30 |
| ens-subgraph-v2 | 122,146 | 34,316 | 3,091 | 39.5x | 11.1x | 27 |
| sushiswap-polygon | 121,669 | 30,956 | 2,395 | 50.8x | 12.9x | 18 |
| uniswap-v4-base ᵈ | 116,543 | 28,907 | 1,626 | 71.7x | 17.8x | 17 |
| uniswap-v4-bsc ᵈ | 116,543 | 28,907 | 1,626 | 71.7x | 17.8x | 17 |
| pancakeswap-v2 | 86,276 | 22,019 | 1,317 | 65.5x | 16.7x | 15 |
| uniswap-v2-ethereum | 86,187 | 21,958 | 1,313 | 65.6x | 16.7x | 15 |
| sushiswap-mainnet | 84,393 | 21,647 | 1,223 | 69.0x | 17.7x | 15 |
| makerdao-governance | 76,646 | 20,386 | 1,777 | 43.1x | 11.5x | 16 |
| lido-ethereum | 68,445 | 19,817 | 3,405 | **20.1x** | 5.8x | 11 |
| balancer-gauges-arbitrum | 61,461 | 17,915 | 2,045 | 30.1x | 8.8x | 16 |
| balancer-v3-sonic | 59,414 | 17,191 | 2,117 | 28.1x | 8.1x | 15 |
| uniswap-v4-ethereum ᵉ | 7,469 | 1,846 | 246 | 30.4x | 7.5x | 1 |

<sub>ᵃᵇᶜᵈ Identical schemas — shared Messari standardized schema (a, b), Uniswap V3 fork (c), same V4 deployment schema (d). ᵉ Single-entity deployment, likely a stub; included for completeness but it tells you little.</sub>

**Aggregates across all 30 rows:**

| | |
| --- | ---: |
| Median reduction vs raw introspection | **32.0x** |
| Range vs raw introspection | 20.1x – 78.3x |
| Aggregate vs raw (Σraw ÷ Σdigest) | **30.0x** |
| Aggregate vs printed SDL (Σsdl ÷ Σdigest) | **8.2x** |
| Total tokens, raw → digest | 5,337,846 → 177,728 |

Over 25 distinct schemas rather than 30 rows: median 33.8x, aggregate 31.7x vs raw and 8.6x vs SDL.

The "SDL" column is a deliberately charitable second baseline. It's the introspection result rendered back to a schema string via `printSchema(buildClientSchema(...))` — structurally identical information, minus the JSON overhead, but still carrying every generated `_filter` and `_orderBy` type. Comparing against it rather than only against raw JSON is the fairer test, and the condenser still wins by 6–21x.

Token counts use `gpt-tokenizer` (cl100k_base) as a consistent proxy. Absolute counts will differ slightly on other tokenizers; ratios will not move meaningfully.

### Why the reduction varies so much

The spread is 20.1x to 78.3x, which is wide enough that a single headline multiplier would be misleading. The variance has one dominant cause, and it isn't entity count.

Per-entity cost in the digest ranges from **82 tokens** (sushiswap-mainnet, uniswap-v2) to **549 tokens** (gmx-avalanche). That 6x spread tracks almost exactly with whether the subgraph author wrote GraphQL docstrings. The Messari-standardized schemas — Aave, Compound, GMX, Curve — document nearly every field, and those descriptions survive introspection. The Uniswap-family schemas use `#` comments, which don't appear in introspection at all.

The condenser preserves descriptions verbatim, because a field called `totalValueLockedUSD` is self-explanatory but a field called `cumulativeUniqueUsers` genuinely benefits from its one-line doc. So heavily documented schemas condense less — and the tokens they keep are the ones actually worth keeping.

This is why `lido-ethereum` sits at the bottom of the table with 20.1x despite having only 11 entities: it's small *and* well documented, so there's less boilerplate to strip and more prose to keep. It's the honest floor of the range.

### Scope, and what these numbers are not

These figures measure **condensed digest against introspection output**. They are not a like-for-like improvement over The Graph's official Subgraph MCP, and presenting them that way would be dishonest.

The official server reads the authored `schema.graphql` from the deployment manifest — a fundamentally cheaper source that this project does not compete with on published subgraphs. Where this tool earns its place is everywhere that source isn't reachable: self-hosted nodes, Studio dev endpoints, unpublished deployments, private indexers, and non-subgraph GraphQL APIs. In those environments introspection is the only option and the reduction above is exactly what you get.

A direct digest-versus-manifest-source comparison is the obvious next measurement and is on the roadmap below. It hasn't been run, so it isn't claimed.

---

## Installation

Requires Node 20+ and a Gateway API key from [Subgraph Studio](https://thegraph.com/studio/) (the query key from the *API Keys* tab, not a deploy key).

```bash
git clone <your-repo-url> condgraph
cd condgraph
npm install
```

### Claude Desktop

Add this to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "subgraph-condenser": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/condgraph/src/server/index.ts"],
      "env": {
        "GRAPH_API_KEY": "your_gateway_api_key_here"
      }
    }
  }
}
```

The `env` block is not optional. MCP servers launched by a desktop client do not inherit your shell environment and do not run in the project directory, so a `.env` file will not be picked up. The key has to be passed here.

### Cursor

Same JSON under `mcpServers` in `.cursor/mcp.json`, project-local or global.

### Standalone

```bash
echo "GRAPH_API_KEY=your_key" > .env
npm run dev
```

The server speaks JSON-RPC over stdio; stdout is reserved for the protocol and all logging goes to stderr.

---

## End-to-end validation

The measurements above prove the digest is small. They don't prove it's *sufficient*. This does.

The following ran in Claude Desktop with only this server connected — no other subgraph tooling, no schema pasted into the prompt, no hints about ENS's data model. The model's only knowledge of the schema was what `get_condensed_schema` returned.

> **Prompt:** I want to query the ENS subgraph (ID `5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH`) for the 10 most recently registered domains, showing the domain name, registration timestamp, and owner. First call `get_condensed_schema` to see the schema, then write and execute the query with `execute_query`. Do not guess field names — use what the schema returns.

The model called `get_condensed_schema`, read the digest, identified that the `Registration` entity carries `registrationDate` and relates to `Domain`, which in turn carries `name` and `owner`, and wrote:

```graphql
{
  registrations(first: 10, orderBy: registrationDate, orderDirection: desc) {
    registrationDate
    domain {
      name
      owner { id }
    }
  }
}
```

It executed cleanly against the live gateway on the first attempt:

| # | Domain | Registered (UTC) | Unix | Owner |
| ---: | --- | --- | ---: | --- |
| 1 | mazeking.eth | Jul 25, 2026 11:22 | 1784978543 | `0x1818…25e1` |
| 2 | issuersponsoredtokens.eth | Jul 25, 2026 11:15 | 1784978135 | `0xb3f5…a208` |
| 3 | digitalstocks.eth | Jul 25, 2026 11:11 | 1784977907 | `0xb3f5…a208` |
| 4 | realworlddigitalassets.eth | Jul 25, 2026 10:38 | 1784975915 | `0xb3f5…a208` |
| 5 | rwamarket.eth | Jul 25, 2026 10:19 | 1784974763 | `0xb3f5…a208` |
| 6 | dgtoken.eth | Jul 25, 2026 10:10 | 1784974199 | `0x780a…3752` |
| 7 | poorbutsexy.eth | Jul 25, 2026 10:04 | 1784973827 | `0x569e…fff8` |
| 8 | pgt.eth | Jul 25, 2026 09:57 | 1784973419 | `0x755a…da31` |
| 9 | thehunt.eth | Jul 25, 2026 09:49 | 1784972927 | `0x7502…1081` |
| 10 | fernand1nho.eth | Jul 25, 2026 09:47 | 1784972807 | `0x2ac0…1bbf` |

Four things in that run are worth pointing at, because together they are the argument for the whole project.

The model used `orderBy: registrationDate` and `orderDirection: desc` **without ever seeing `Registration_orderBy` or `OrderDirection`** — both were stripped from the digest. It used `first: 10` without seeing a pagination argument definition. It traversed `Registration → Domain → owner` correctly from the relationship structure alone. And it correctly inferred the plural query root field `registrations`, which the digest also does not contain.

The convention header did the work that 3,455 tokens of ENS boilerplate would otherwise have done.

Unprompted, the model then flagged that `Domain` also exposes `registrant` (the ERC-721 holder) and `wrappedOwner`, and that these can differ from `owner` — a distinction it could only have drawn from reading the condensed schema carefully. It also noticed that four of the ten registrations shared one owner address and looked like a batch. That is a model reasoning about a data model rather than parsing filter permutations, which is exactly the outcome the reduction is supposed to buy.

Anyone can reproduce this. Install per the section above, point Claude Desktop at any subgraph ID in `subgraphs.json`, and ask it a question in plain English. The desktop client doesn't surface token counts, so the reduction itself isn't visible there — that's what `npm run condense` is for. What the desktop run demonstrates is the half the numbers can't: that the small thing still works.

---

## How it works

The condenser is a single pure function, `condense(introspection) → Digest`, plus a renderer. No I/O, no state, no network — which is what makes it exhaustively testable.

**Types that are always dropped.** Introspection meta-types (`__Schema`, `__Type`, and everything else prefixed `__`); the operation roots `Query`, `Mutation`, `Subscription`; graph-node scaffolding `_Meta_`, `_Block_`, `_SubgraphErrorPolicy_`, `Block_height`, `BlockChangedFilter`; the `OrderDirection` enum; and anything whose name ends in `_filter`, `_orderBy`, or `_orderDirection`.

**Input objects are dropped structurally**, not by name. Every `INPUT_OBJECT` in a graph-node schema is generated filter or block-height machinery, so the condenser never emits one. The name-suffix rules above are a second layer of defence, not the primary mechanism.

**Object types are kept** as entities, with each field reduced to name, unwrapped type name, list-ness, non-null-ness, and description.

**Enums are kept** unless they're generated ordering enums. Domain enums like `TransactionType` or `RewardTokenType` carry real information and appear in real queries, so stripping them would break things — this is the one place where a naive "drop all enums" rule would silently produce an insufficient digest.

**Scalars are kept only if referenced.** Built-in scalars (`String`, `Int`, `Float`, `Boolean`, `ID`) are never emitted. Custom scalars are emitted only when some surviving field actually uses them, so an unused `Int8` doesn't cost you a line.

**Output is sorted** — entities, enums, and scalars all alphabetically — so digests are byte-stable across runs and diffable in CI.

Interfaces and unions are intentionally not emitted; see limitations.

---

## Tests

`npm test` runs three layers, via Vitest.

**Layer 1 — synthetic rule specification.** A hand-built `IntrospectionQuery` fixture, written inline in the test file, containing exactly one of each thing the condenser has to handle: two entity types, a `Pool_filter` input object, a `Pool_orderBy` enum, `OrderDirection`, `_Meta_`, a referenced custom scalar (`BigDecimal`), an unreferenced built-in (`String`), and the `Query` root. Each drop rule gets its own assertion. This fixture is the executable specification — if someone changes the classification logic, these fail first and say precisely which rule broke.

It also pins the type-reference unwrapping: a `NON_NULL(LIST(NON_NULL(OBJECT Swap)))` field must come out as `typeName: "Swap"`, `isList: true`, `isNonNull: true`. Getting that wrong is the easiest way to silently corrupt a digest.

**Layer 2 — named real-schema check.** The Uniswap V3 fixture is asserted directly: the rendered digest must contain `type Pool {`, `type Token {`, and `type Swap {`, and must contain no `_filter`, no `_orderBy`, no `OrderDirection`, and no `_Meta_`. This is the sanity check that the synthetic rules survive contact with a 161,647-token real schema.

**Layer 3 — invariants across every fixture.** Parameterised with `it.each` over all 30 saved introspection files, so the suite grows automatically as fixtures are added. Two invariants per subgraph:

- *No boilerplate leaks.* The rendered digest matches none of `/\b\w+_filter\b/`, `/\b\w+_orderBy\b/`, `OrderDirection`, `_Meta_`, or `/\b__\w+/`. Regex-based rather than exact-match, so it catches generated types this codebase has never seen.
- *Real reduction, non-trivial output.* Every digest must have at least one entity, and `rawSize / digestSize` must exceed 10. That second assertion is a regression guard on the entire premise: if a future change starts leaking generated types back in, the ratio collapses and the build fails before anyone reads a README number that's no longer true.

The suite skips cleanly with an explanatory message if `data/fixtures/` is empty, so a fresh clone can run tests before running `npm run measure`.

`npm run typecheck` runs `tsc --noEmit` in strict mode across `src/`, `scripts/`, and `tests/`.

---

## Reproducing the numbers

```bash
npm run measure    # live-fetch introspection for all 30 subgraphs,
                   # save fixtures + SDL, print the raw/SDL baseline table
npm run condense   # condense every fixture, write digests,
                   # print the full reduction table and aggregates
npm test           # the three test layers described above
npm run typecheck  # strict TypeScript, no emit
```

`measure` needs a valid `GRAPH_API_KEY` and network access; it writes `data/fixtures/*.introspection.json` and `data/fixtures/*.sdl.graphql`. `condense` is fully offline once fixtures exist — it reads the saved JSON, writes `data/digests/*.digest.graphql`, and emits both `data/condense-results.json` and a markdown table at `data/condense-results.md`.

Statistics are computed by a small shared `summarize()` helper reporting n, mean, median, min, max, and sample standard deviation (n−1). Both the per-subgraph mean and the aggregate Σ/Σ ratio are reported, because they differ — 40.2x versus 30.0x across the raw table — and quoting only the flattering one would be exactly the kind of thing this README is trying not to do.

---

## Known limitations

Stated plainly, because a tool whose entire pitch is "we removed the right things" owes you a list of what it removes that you might miss.

**Interfaces and unions are dropped.** Subgraph schemas rarely use them in ways that affect query construction — an object implementing an interface still exposes all its own fields — but if you need fragment spreads on an interface type, the digest won't help you write them.

**Query root field names are omitted.** The digest tells you `Pool` exists; it doesn't tell you the entry points are `pool` and `pools`. graph-node's pluralization is not uniform (`Factory` becomes `factories`, `PoolDayData` becomes `poolDayDatas`), so a model has to infer it. In the ENS validation above the inference was correct on the first try, but "usually correct" is not "correct," and closing this gap is the first roadmap item.

**Filter conventions are stated generically.** The header describes the full family of comparison suffixes, but not every suffix applies to every field — `_contains` is for strings and arrays, `_gt` for ordered scalars. A model can construct a filter that doesn't exist. In practice this surfaces as one clear GraphQL error and a retry, not a wrong answer.

**Descriptions are preserved verbatim.** As documented above, this makes heavily annotated schemas condense less. There is currently no way to turn it off.

**Token counts are a proxy.** `gpt-tokenizer` (cl100k_base) is used consistently everywhere, but the exact figures will shift on a different tokenizer family.

**No caching.** Every `get_condensed_schema` call re-fetches the full introspection payload from the gateway. Repeat calls for the same subgraph in one session pay the full network cost each time.

**Sample composition.** 30 IDs, 25 distinct schemas, weighted toward DeFi. Broad enough to be meaningful, not broad enough to be a census.

---

## Roadmap

**Emit query root field names.** Introspection contains the exact generated entry points, which the authored `schema.graphql` does not. Including just the names and return types — a few hundred tokens for a large schema — would make the digest strictly more query-accurate than the source file itself. This is the highest-value change available and it's small.

**Measure against the manifest source.** Fetch `manifest { schema { schema } }` for all 30 IDs and add it as a fourth baseline column. It's the comparison a Graph engineer will want, and the honest answer probably varies a lot by schema: a clear win on lean schemas like Uniswap V3, closer to parity on heavily documented Messari ones. Worth knowing either way.

**A `validate()` round-trip test.** Mechanically generate a query from each digest, then run `graphql`'s `validate()` against `buildClientSchema(introspection)`. That would turn "the digest is sufficient" from a demonstrated claim into a proven one, across all 25 schemas, offline, with no model in the loop.

**Optional description truncation.** A verbosity flag or first-sentence truncation would let GMX's 13,728-token digest come down substantially for callers who want maximum compression.

**In-memory caching**, and lazy credential checking so a missing API key produces a readable tool error instead of a startup crash.

**Semantic field selection**, only for schemas that are still large after stripping: embed the surviving entities and the user's question, keep the top-k. This is the correct home for anything vector-shaped — it layers on top of deterministic filtering rather than replacing it, and it should never be the first thing tried.

---

## Project layout

```
src/
  condenser/
    index.ts        condense() + renderDigest() — pure, no I/O
    types.ts        Digest, Entity, Field, DomainEnum
  gateway/
    client.ts       gateway URL construction, introspection + query execution
  server/
    index.ts        MCP server, tool definitions, stdio transport
scripts/
  measure.ts        live fetch → fixtures + raw/SDL baseline table
  condense.ts       fixtures → digests + full reduction table
tests/
  condenser.test.ts three test layers
stats.ts            summarize(): n, mean, median, min, max, sample stdev
subgraphs.json      the 30 subgraph IDs
data/               fixtures, digests, results (generated)
```

## Stack

TypeScript on Node, `@modelcontextprotocol/sdk` for the server, `graphql` for introspection types and schema utilities, `graphql-request` for the gateway, `gpt-tokenizer` for token counting, Vitest for tests, `tsx` for execution. No database, no frontend, no contracts, no deployed subgraph.

## A note on terminology

This walks a **GraphQL introspection result** — a JSON representation of a type system — and filters it. It does not parse or traverse an AST. It's an introspection pruner, and calling it anything more impressive would be inaccurate.

Likewise: the digest preserves the entities, fields, relationships, enums, and scalars needed for typical analytical queries. It does not preserve 100% of the schema, and it isn't meant to.

## Where this was going

This was a solo build over a hackathon weekend, which meant picking a floor that would ship and refusing to start anywhere else. The condenser is that floor. It is not, and was never meant to be, the whole idea.

The intended next layer is semantic retrieval over condensed digests. Today an agent has to be told which subgraph to look at. The interesting questions aren't shaped like that — "where has lending collateral been migrating this quarter," "which protocols expose liquidation events I can compare across chains" — and answering them means working out which subgraphs are even relevant before writing a single query, then reasoning across several of them at once. Keyword search over display names doesn't get you there; searching "Uniswap" finds Uniswap. It can't find *the set of subgraphs that happen to model the concept you're asking about*.

Embeddings over schema content can, and this is where the condenser turns out to be a prerequisite rather than a detour.

Raw introspection is unusable as an embedding substrate. Across the 30 subgraphs measured here it's 5.3 million tokens, and the overwhelming majority of that is generated `_filter` and `_orderBy` machinery with near-identical shape in every subgraph on the network. Embed that and everything collapses toward the same region of the vector space, because the dominant signal is the boilerplate they all share rather than the entities that tell them apart. Strip it and what remains — entity names, field names, and whatever the author bothered to document — is precisely the discriminative part. 177,728 tokens across 30 subgraphs is a trivially indexable corpus.

So the sequencing was deliberate: deterministic filtering first, because it's testable and because it produces the clean signal the semantic layer would need; embedding-based selection second, layered on top without touching it. Doing it the other way round would have meant building a vector index over mostly-noise and hoping.

The honest hard part, which retrieval does not solve: knowing *which* subgraphs are relevant is not the same as knowing how to reconcile them. Different subgraphs use different entity models, run on different chains, use incompatible ID schemes, and measure time differently. Routing a question to four subgraphs is tractable; joining their answers into one coherent result is a separate problem, and not one an embedding index makes go away.

What shipped is the substrate. The layer above it is described here as intent, not as something that exists.

## License

MIT
