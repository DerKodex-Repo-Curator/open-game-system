/**
 * Reference tables generated from the zod schemas in packages/ogs-protocol at build time, so the
 * docs cannot drift from the protocol. Field descriptions come from the schemas' own comments; the
 * few fields without one are described in NOTES below (and a test fails if any field has neither).
 */
import { resolve } from "node:path";
import {
  AccountBridgeEventSchema,
  AccountBridgeStateSchema,
  CouchClaimSchema,
  GamePlayerSchema,
  GameTokenSchema,
  GameToLauncherSchema,
  HapticsBridgeEventSchema,
  InstanceReportSchema,
  InstanceStatusSchema,
  LauncherToGameSchema,
  ManifestSchema,
  RoleSchema,
  RoomIdSchema,
  RosterEntrySchema,
} from "@open-game-system/ogs-protocol";
import { z } from "zod";
import { schemaDocs } from "./jsdoc";
import { REPO_ROOT } from "./paths";

const protocolFile = (name: string) => resolve(REPO_ROOT, "packages/ogs-protocol/src", name);

/** Schemas shown by name (with their own table) wherever they are used. */
const NAMED = new Map<z.ZodTypeAny, string>([
  [GamePlayerSchema, "GamePlayer"],
  [RosterEntrySchema, "RosterEntry"],
  [InstanceReportSchema, "InstanceReport"],
  [CouchClaimSchema, "CouchClaim"],
  [RoleSchema, "Role"],
  [RoomIdSchema, "RoomId"],
  [InstanceStatusSchema, "InstanceStatus"],
]);

/** Descriptions for fields whose schema has no comment. Keyed like schemaDocs. */
const NOTES: Record<string, Record<string, string>> = {
  manifest: {
    appId: "The game's id; also the `aud` of every game token for this game.",
    name: "Shown in the Library and on the TV.",
    tagline: "One line under the name in the Library.",
    shape:
      "`couch`: played together in one room; `live`: real-time online; `async`: turns over days.",
    tv: "Whether the game needs a TV.",
    roles: "Who plays: each role's `audience` lets OGS suggest who sits where.",
    art: "The art kit (see Art kit and catalogue).",
    "art.cover": "2:3 cover with the title.",
    "art.logo": "Transparent logo.",
    "art.heroClean": "16:9 hero with no text and no HUD.",
    "art.tile": "Older captured TV screenshot, 16:9 (required).",
    "art.hero": "Older captured hero image, 16:9.",
    "art.icon": "1:1 icon.",
    "art.safe": "Crops a HUD out of `tile`/`hero` when there is no clean art: zoom about a point.",
    "art.safe.scale": "Zoom factor.",
    "art.safe.ox": "Zoom origin x, percent of the width.",
    "art.safe.oy": "Zoom origin y, percent of the height.",
    shop: "Shown on the game's page in the app.",
    "shop.ages": 'For example `"4+"`.',
    "shop.minutes": "Typical sitting length, `[min, max]` minutes.",
    "shop.players": 'For example `"2-4"`.',
  },
  "launcher-to-game": {
    "ogs:start.instanceId": "The OGS sitting this frame is for.",
    "ogs:start.mode": "`continue` an earlier sitting, or start a `new` one.",
    "ogs:start.roster": "Who sits where: profile, role and device, when the couch picked roles.",
    "ogs:suspend":
      "The launcher parked the frame (Home, or another game). It stays loaded: go silent.",
    "ogs:resume": "Continue: the same parked frame is shown again, no reload. Resume sound.",
    "ogs:start":
      "The sitting starts or continues. Sent on the frame's load, and again after each `ogs:ready`.",
  },
  "game-to-launcher": {
    "ogs:ready":
      "The page is listening; the launcher re-sends `ogs:start` for the current sitting.",
    "ogs:resume-point": "The sitting's label (older form of `ogs:instance`).",
    "ogs:resume-point.label": 'For example `"Mission 6"`.',
    "ogs:room.room": "The game's own room code.",
    "ogs:instance": "The sitting's report; the launcher uses `report.title` as its label.",
    "ogs:instance.report": "What the game says about this sitting.",
  },
  GamePlayer: {
    id: "OGS profile id.",
    handle: "The profile's @handle.",
    name: "Display name.",
    avatar: "Avatar image URL.",
  },
  RosterEntry: {
    profileId: "OGS profile id.",
    roleId: "One of the manifest's `roles[].id`.",
    deviceId: "The device this player plays on.",
  },
  CouchClaim: {
    sid: "The couch session id. Players with the same `sid` sit on the same couch.",
    label: "The couch's label (the host's name).",
  },
  InstanceReport: {
    instanceId: "The sitting's id.",
    appId: "The game's appId.",
    status: "Where the sitting is.",
    title: 'The sitting\'s label, for example `"Mission 6"` or `"Room KQTP"`.',
    detail: "A second line under the label.",
  },
  GameToken: {
    handle: "The profile's @handle.",
    name: "Display name.",
    avatar: "Avatar image URL.",
    iat: "Issued at, seconds since epoch.",
    exp: "Expiry, seconds since epoch (1 hour after `iat`).",
  },
  Role: {
    id: "The role's id (`RosterEntry.roleId`).",
    label: 'Shown to people, for example `"Captain"`.',
    audience: "Who the role suits: a grown-up, a kid, or a little one.",
  },
};

type Row = { field: string; type: string; required: string; description: string };

function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; required: string } {
  if (schema instanceof z.ZodOptional) return { inner: schema._def.innerType, required: "no" };
  if (schema instanceof z.ZodDefault)
    return {
      inner: schema._def.innerType,
      required: `no (default \`${JSON.stringify(schema._def.defaultValue())}\`)`,
    };
  return { inner: schema, required: "yes" };
}

function stringType(s: z.ZodString): string {
  const notes = s._def.checks.flatMap((c) => {
    if (c.kind === "url") return ["URL"];
    if (c.kind === "regex") return [`\`${c.regex.source}\``];
    if (c.kind === "min" && c.value === 1) return ["non-empty"];
    return [];
  });
  return notes.length ? `string (${notes.join(", ")})` : "string";
}

function numberType(n: z.ZodNumber): string {
  const notes = n._def.checks.flatMap((c) => {
    if (c.kind === "int") return ["integer"];
    if (c.kind === "min" && c.value === 0) return [c.inclusive ? "≥ 0" : "> 0"];
    return [];
  });
  return notes.length ? `number (${notes.join(", ")})` : "number";
}

/** A type expression for one schema, in TypeScript-ish notation. */
export function typeOf(schema: z.ZodTypeAny): string {
  const named = NAMED.get(schema);
  if (named) return `[${named}](#${named.toLowerCase()})`;
  if (schema instanceof z.ZodString) return stringType(schema);
  if (schema instanceof z.ZodNumber) return numberType(schema);
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodLiteral) return JSON.stringify(schema._def.value);
  if (schema instanceof z.ZodEnum)
    return schema._def.values.map((v: string) => JSON.stringify(v)).join(" \\| ");
  if (schema instanceof z.ZodArray) {
    const el = typeOf(schema._def.type);
    return el.includes(" ") ? `(${el})[]` : `${el}[]`;
  }
  if (schema instanceof z.ZodTuple)
    return `[${schema._def.items.map((i: z.ZodTypeAny) => typeOf(i)).join(", ")}]`;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault)
    return typeOf(unwrap(schema).inner);
  if (schema instanceof z.ZodObject) return "object (below)";
  throw new Error(`docs: no rendering for zod type ${schema.constructor.name}`);
}

/** One row per field, nested objects flattened as `art.icon`. */
function rows(
  shape: z.ZodRawShape,
  docs: Map<string, string>,
  notes: Record<string, string>,
  prefix = "",
  docPrefix = "",
): Row[] {
  return Object.entries(shape).flatMap(([key, field]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const docPath = docPrefix ? `${docPrefix}.${key}` : key;
    const { inner, required } = unwrap(field);
    const description = notes[docPath] ?? docs.get(docPath) ?? "";
    const own: Row = { field: `\`${path}\``, type: typeOf(inner), required, description };
    if (inner instanceof z.ZodObject && !NAMED.has(inner)) {
      own.type = "object";
      return [own, ...rows(inner.shape, docs, notes, path, docPath)];
    }
    return [own];
  });
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

function table(list: Row[]): string {
  const head = "| Field | Type | Required | Description |\n|---|---|---|---|";
  const body = list.map(
    (r) => `| ${r.field} | ${r.type} | ${r.required} | ${cell(r.description) || "—"} |`,
  );
  return [head, ...body].join("\n");
}

const generatedRows: Row[] = [];

function objectTable(
  schema: z.AnyZodObject,
  docs: Map<string, string>,
  notes: Record<string, string>,
  docPrefix = "",
): string {
  const list = rows(schema.shape, docs, notes, "", docPrefix);
  generatedRows.push(...list);
  return table(list);
}

function unionSection(
  union: z.ZodDiscriminatedUnion<"type", z.AnyZodObject[]>,
  docs: Map<string, string>,
  notes: Record<string, string>,
): string {
  return union.options
    .map((option) => {
      const { type, ...fields } = option.shape;
      if (!(type instanceof z.ZodLiteral)) throw new Error("docs: union member without type");
      const name = String(type._def.value);
      const what = notes[name] ?? docs.get(name) ?? "";
      if (!what)
        generatedRows.push({ field: name, type: "message", required: "", description: "" });
      const body = Object.keys(fields).length
        ? objectTable(z.object(fields), docs, notes, name)
        : `No payload: \`{ type: ${JSON.stringify(name)} }\`.`;
      return `### \`${name}\`\n\n${what}\n\n${body}`;
    })
    .join("\n\n");
}

function namedTypes(): string {
  const gameToken = schemaDocs(protocolFile("game-token.ts"), "GameTokenSchema");
  const player = schemaDocs(protocolFile("game-token.ts"), "GamePlayerSchema");
  const couch = schemaDocs(protocolFile("game-token.ts"), "CouchClaimSchema");
  const instance = schemaDocs(protocolFile("instance.ts"), "InstanceSchema");
  const roster = schemaDocs(protocolFile("session.ts"), "RosterEntrySchema");
  const role = schemaDocs(protocolFile("manifest.ts"), "RoleSchema");
  const sections: [string, string, string][] = [
    [
      "GamePlayer",
      "Someone on the couch (`ogs:start.players`, `GameToken.players`).",
      objectTable(GamePlayerSchema, player, NOTES.GamePlayer ?? {}),
    ],
    [
      "RosterEntry",
      "Who sits where (`ogs:start.roster`).",
      objectTable(RosterEntrySchema, roster, NOTES.RosterEntry ?? {}),
    ],
    [
      "InstanceReport",
      "What a game reports about a sitting (`ogs:instance`, `reportOgsSitting`). Only `instanceId`, `appId` and `status` are needed.",
      objectTable(InstanceReportSchema, instance, NOTES.InstanceReport ?? {}),
    ],
    [
      "InstanceStatus",
      "",
      `One of ${InstanceStatusSchema.options.map((o) => `\`${o}\``).join(", ")}.`,
    ],
    [
      "GameToken",
      "The claims of a game token, as `verifyOgsToken` returns them.",
      objectTable(GameTokenSchema, gameToken, NOTES.GameToken ?? {}),
    ],
    [
      "CouchClaim",
      "The couch a token was issued for.",
      objectTable(CouchClaimSchema, couch, NOTES.CouchClaim ?? {}),
    ],
    ["Role", "One of the manifest's roles.", objectTable(RoleSchema, role, NOTES.Role ?? {})],
    [
      "RoomId",
      "",
      `A string matching \`${RoomIdSchema._def.checks.map((c) => (c.kind === "regex" ? c.regex.source : "")).join("")}\`: the game's own room code.`,
    ],
  ];
  return sections
    .map(([name, what, body]) => `### \`${name}\`\n\n${what ? `${what}\n\n` : ""}${body}`)
    .join("\n\n");
}

/** `<!-- schema:NAME -->` placeholders in content, and what replaces them. */
export function schemaBlocks(): Record<string, () => string> {
  return {
    "launcher-to-game": () =>
      unionSection(
        LauncherToGameSchema,
        schemaDocs(protocolFile("frame.ts"), "LauncherToGameSchema"),
        NOTES["launcher-to-game"] ?? {},
      ),
    "game-to-launcher": () =>
      unionSection(
        GameToLauncherSchema,
        schemaDocs(protocolFile("frame.ts"), "GameToLauncherSchema"),
        NOTES["game-to-launcher"] ?? {},
      ),
    manifest: () =>
      objectTable(
        ManifestSchema,
        schemaDocs(protocolFile("manifest.ts"), "ManifestSchema"),
        NOTES.manifest ?? {},
      ),
    types: () => namedTypes(),
    haptics: () =>
      unionSection(
        HapticsBridgeEventSchema,
        schemaDocs(protocolFile("native.ts"), "HapticsBridgeEventSchema"),
        {},
      ),
    "account-state": () =>
      objectTable(
        AccountBridgeStateSchema,
        schemaDocs(protocolFile("native.ts"), "AccountBridgeStateSchema"),
        {},
      ),
    "account-events": () =>
      unionSection(
        AccountBridgeEventSchema,
        schemaDocs(protocolFile("native.ts"), "AccountBridgeEventSchema"),
        {},
      ),
  };
}

/** Every row of every generated table, built fresh (for the "every field is described" test). */
export function allSchemaRows(): Row[] {
  generatedRows.length = 0;
  for (const make of Object.values(schemaBlocks())) make();
  return [...generatedRows];
}

export function fillSchemaBlocks(markdown: string): string {
  const blocks = schemaBlocks();
  return markdown.replace(/<!-- schema:([a-z-]+) -->/g, (_m, name: string) => {
    const make = blocks[name];
    if (!make) throw new Error(`docs: unknown schema block "${name}"`);
    return make();
  });
}
