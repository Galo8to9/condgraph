import type {
  IntrospectionQuery,
  IntrospectionType,
  IntrospectionObjectType,
  IntrospectionEnumType,
  IntrospectionScalarType,
  IntrospectionField,
  IntrospectionTypeRef,
  IntrospectionNamedTypeRef,
} from "graphql";
import type { Digest, Entity, Field, DomainEnum } from "./types.js";

export type { Digest } from "./types.js";

// ---------- classification ----------

/** Types the gateway auto-generates that we always drop. */
const DROP_TYPE_NAMES = new Set([
  "Query",
  "Subscription",
  "Mutation",
  "Block_height",
  "BlockChangedFilter",
  "_Meta_",
  "_Block_",
  "_SubgraphErrorPolicy_",
  "OrderDirection",
]);

/** Standard GraphQL scalars — never emitted as custom scalars. */
const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

function isIntrospectionMeta(name: string): boolean {
  return name.startsWith("__");
}

function isGeneratedFilterOrOrder(name: string): boolean {
  return (
    name.endsWith("_filter") ||
    name.endsWith("_orderBy") ||
    name.endsWith("_orderDirection")
  );
}

function shouldDropType(t: IntrospectionType): boolean {
  const name = t.name;
  if (isIntrospectionMeta(name)) return true;
  if (DROP_TYPE_NAMES.has(name)) return true;
  if (isGeneratedFilterOrOrder(name)) return true;
  return false;
}

// ---------- type-ref unwrapping ----------

interface UnwrappedRef {
  typeName: string;
  isList: boolean;
  isNonNull: boolean;
}

function unwrapTypeRef(ref: IntrospectionTypeRef): UnwrappedRef {
  let isNonNull = false;
  let isList = false;
  let cur: IntrospectionTypeRef = ref;

  if (cur.kind === "NON_NULL") {
    isNonNull = true;
    cur = cur.ofType;
  }
  if (cur.kind === "LIST") {
    isList = true;
    cur = cur.ofType;
    // Peel inner NonNull on list items — we only care about outer nullability.
    if (cur.kind === "NON_NULL") cur = cur.ofType;
  }
  // At this point cur should be a named type.
  const named = cur as IntrospectionNamedTypeRef;
  return { typeName: named.name, isList, isNonNull };
}

// ---------- field extraction ----------

function extractField(f: IntrospectionField): Field {
  const { typeName, isList, isNonNull } = unwrapTypeRef(f.type);
  return {
    name: f.name,
    typeName,
    isList,
    isNonNull,
    description: f.description ?? null,
  };
}

// ---------- main ----------

export function condense(introspection: IntrospectionQuery): Digest {
  const allTypes = introspection.__schema.types;

  const entities: Entity[] = [];
  const enums: DomainEnum[] = [];
  const referencedTypeNames = new Set<string>();

  for (const t of allTypes) {
    if (shouldDropType(t)) continue;

    if (t.kind === "OBJECT") {
      const obj = t as IntrospectionObjectType;
      const fields = obj.fields.map(extractField);
      for (const f of fields) referencedTypeNames.add(f.typeName);
      entities.push({
        name: obj.name,
        description: obj.description ?? null,
        fields,
      });
    } else if (t.kind === "ENUM") {
      const en = t as IntrospectionEnumType;
      enums.push({
        name: en.name,
        description: en.description ?? null,
        values: en.enumValues.map((v) => v.name),
      });
    }
    // INPUT_OBJECT, INTERFACE, UNION intentionally skipped for the floor.
    // Subgraph schemas rarely use them meaningfully; revisit if a real
    // subgraph proves otherwise.
  }

  // Custom scalars, but only those actually referenced by kept fields.
  const scalars: string[] = [];
  for (const t of allTypes) {
    if (t.kind !== "SCALAR") continue;
    const s = t as IntrospectionScalarType;
    if (BUILTIN_SCALARS.has(s.name)) continue;
    if (!referencedTypeNames.has(s.name)) continue;
    scalars.push(s.name);
  }

  // Stable ordering for reproducible snapshots.
  entities.sort((a, b) => a.name.localeCompare(b.name));
  enums.sort((a, b) => a.name.localeCompare(b.name));
  scalars.sort();

  const typesKept = entities.length + enums.length + scalars.length;
  return {
    entities,
    enums,
    scalars,
    stats: {
      typesInSchema: allTypes.length,
      typesKept,
      typesDropped: allTypes.length - typesKept,
    },
  };
}

// ---------- rendering ----------

const HEADER = `# Condensed subgraph schema.
# Filters and ordering follow standard subgraph conventions and are omitted here:
#   where: { <field>: value, <field>_gt: value, <field>_lt: value,
#            <field>_gte: value, <field>_lte: value, <field>_in: [values],
#            <field>_not: value, <field>_contains: substring, ... }
#   orderBy: <any field on the entity>
#   orderDirection: asc | desc
#   first: <n>   skip: <n>   block: { number: <n> }
# Apply these to any list query on the entities below.
`;

function renderFieldType(f: Field): string {
  const base = f.isList ? `[${f.typeName}!]` : f.typeName;
  return f.isNonNull ? `${base}!` : base;
}

function renderField(f: Field): string {
  const line = `  ${f.name}: ${renderFieldType(f)}`;
  return f.description
    ? `  "${f.description.replace(/"/g, "'")}"\n${line}`
    : line;
}

function renderEntity(e: Entity): string {
  const desc = e.description ? `"${e.description.replace(/"/g, "'")}"\n` : "";
  const body = e.fields.map(renderField).join("\n");
  return `${desc}type ${e.name} {\n${body}\n}`;
}

function renderEnum(e: DomainEnum): string {
  return `enum ${e.name} {\n${e.values.map((v) => `  ${v}`).join("\n")}\n}`;
}

export function renderDigest(digest: Digest): string {
  const parts: string[] = [HEADER];

  if (digest.scalars.length > 0) {
    parts.push(digest.scalars.map((s) => `scalar ${s}`).join("\n"));
  }
  if (digest.enums.length > 0) {
    parts.push(digest.enums.map(renderEnum).join("\n\n"));
  }
  if (digest.entities.length > 0) {
    parts.push(digest.entities.map(renderEntity).join("\n\n"));
  }
  return parts.join("\n\n") + "\n";
}

/** Convenience: introspection JSON → rendered digest string. */
export function condenseToString(introspection: IntrospectionQuery): string {
  return renderDigest(condense(introspection));
}
