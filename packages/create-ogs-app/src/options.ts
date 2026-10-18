import { parseArgs as nodeParseArgs } from "node:util";
import { z } from "zod";

/** The @open-game-system/shell version a new app depends on. */
export const SHELL_VERSION = "^0.1.0";

/** Where a new app goes when no directory is given: an `app/` folder in the game's repo. */
export const DEFAULT_DIR = "app";

const SHARED_HOSTS = [
  "pages.dev",
  "workers.dev",
  "vercel.app",
  "netlify.app",
  "github.io",
  "web.app",
  "firebaseapp.com",
  "onrender.com",
  "fly.dev",
  "herokuapp.com",
  "itch.io",
];

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const httpsUrl = z
  .string()
  .trim()
  .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", {
    message: "must be an https:// URL (the game's phone page)",
  });

const linkDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HOSTNAME, "must be a bare domain like rocketcrew.tv (no https://, no path)")
  .refine((d) => d !== "opengame.org" && !d.endsWith(".opengame.org"), {
    message: "opengame.org/play/<appId> is always on; list only your own domains",
  });

export const AnswersSchema = z.object({
  dir: z.string().trim().min(1, "the directory can't be empty"),
  appId: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be your OGS catalogue id, like rocket-crew"),
  name: z
    .string()
    .trim()
    .min(1, "the app needs a name")
    .max(30, "App Store names are at most 30 characters")
    .regex(/^[^"\\`\r\n]+$/, "no quotes, backslashes or backticks"),
  gameUrl: httpsUrl,
  bundleId: z
    .string()
    .trim()
    .max(155)
    .regex(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/, "must be reverse-DNS, like tv.rocketcrew.app"),
  androidPackage: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/,
      "must be like tv.rocketcrew.app (letters, digits and _; each part starts with a letter)",
    ),
  teamId: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{10}$/, "must be 10 characters (A-Z, 0-9), like 34S957HD77"),
  linkDomains: z.array(linkDomain).transform((domains) => [...new Set(domains)]),
  branding: z.enum(["hidden", "powered-by"]).default("hidden"),
  shellVersion: z.string().trim().min(1).default(SHELL_VERSION),
});

export type Answers = z.output<typeof AnswersSchema>;
type AnswerKey = keyof Answers;

/** What came from the command line: anything may be missing. */
export interface Args {
  dir?: string;
  appId?: string;
  name?: string;
  gameUrl?: string;
  bundleId?: string;
  androidPackage?: string;
  teamId?: string;
  linkDomains?: string[];
  branding?: string;
  shellVersion?: string;
  yes: boolean;
  help: boolean;
}

export type ParseResult = { ok: true; args: Args } | { ok: false; error: string };

const splitList = (values: string[]) =>
  values
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

export function parseArgs(argv: string[]): ParseResult {
  let parsed: ReturnType<typeof parseCli>;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    return {
      ok: false,
      error: `give one directory, not ${positionals.length}: ${positionals.join(" ")}`,
    };
  }
  const args: Args = { yes: values.yes === true, help: values.help === true };
  const [dir] = positionals;
  if (dir !== undefined) args.dir = dir;
  if (values["app-id"] !== undefined) args.appId = values["app-id"];
  if (values.name !== undefined) args.name = values.name;
  if (values["game-url"] !== undefined) args.gameUrl = values["game-url"];
  if (values["bundle-id"] !== undefined) args.bundleId = values["bundle-id"];
  if (values.package !== undefined) args.androidPackage = values.package;
  if (values["team-id"] !== undefined) args.teamId = values["team-id"];
  if (values["link-domain"] !== undefined) args.linkDomains = splitList(values["link-domain"]);
  if (values["no-link-domain"] === true) args.linkDomains = [];
  if (values.branding !== undefined) args.branding = values.branding;
  if (values["shell-version"] !== undefined) args.shellVersion = values["shell-version"];
  return { ok: true, args };
}

function parseCli(argv: string[]) {
  return nodeParseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "app-id": { type: "string" },
      name: { type: "string" },
      "game-url": { type: "string" },
      "bundle-id": { type: "string" },
      package: { type: "string" },
      "team-id": { type: "string" },
      "link-domain": { type: "string", multiple: true },
      "no-link-domain": { type: "boolean" },
      branding: { type: "string" },
      "shell-version": { type: "string" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
}

function hostOf(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined;
  const host = new URL(url).hostname.toLowerCase();
  if (!HOSTNAME.test(host)) return undefined;
  if (SHARED_HOSTS.some((shared) => host === shared || host.endsWith(`.${shared}`)))
    return undefined;
  return host;
}

export function defaultName(appId: string): string {
  return appId
    .split("-")
    .filter((w) => w.length > 0)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

/** `https://rocketcrew.tv/phone` → `tv.rocketcrew.app`; nothing for shared hosts (pages.dev…). */
export function defaultBundleId(gameUrl: string): string | undefined {
  const host = hostOf(gameUrl)?.replace(/^www\./, "");
  if (!host) return undefined;
  return [...host.split(".").reverse(), "app"].join(".");
}

export function defaultAndroidPackage(bundleId: string): string | undefined {
  const pkg = bundleId.toLowerCase().replace(/-/g, "_");
  return AnswersSchema.shape.androidPackage.safeParse(pkg).success ? pkg : undefined;
}

export function defaultLinkDomains(gameUrl: string): string[] {
  const host = hostOf(gameUrl);
  return host ? [host] : [];
}

/** One prompt per answer, in order. `fallback` computes the default from earlier answers. */
interface Field {
  key: Exclude<AnswerKey, "shellVersion">;
  flag: string;
  question: string;
  fallback: (so: Partial<Answers>) => string | undefined;
  /** The earlier answer the default comes from: when that one is missing, only it is reported. */
  dependsOn?: AnswerKey;
}

export const FIELDS: Field[] = [
  { key: "dir", flag: "<dir>", question: "Directory for the app", fallback: () => DEFAULT_DIR },
  {
    key: "appId",
    flag: "--app-id",
    question: "OGS app id (your game's catalogue id, like rocket-crew)",
    fallback: () => undefined,
  },
  {
    key: "name",
    flag: "--name",
    question: "App name (under the icon, ≤ 30 characters)",
    fallback: (so) => (so.appId ? defaultName(so.appId) : undefined),
    dependsOn: "appId",
  },
  {
    key: "gameUrl",
    flag: "--game-url",
    question: "Game URL (the phone page the app opens, https://)",
    fallback: () => undefined,
  },
  {
    key: "bundleId",
    flag: "--bundle-id",
    question: "iOS bundle id",
    fallback: (so) => (so.gameUrl ? defaultBundleId(so.gameUrl) : undefined),
    dependsOn: "gameUrl",
  },
  {
    key: "androidPackage",
    flag: "--package",
    question: "Android package",
    fallback: (so) => (so.bundleId ? defaultAndroidPackage(so.bundleId) : undefined),
    dependsOn: "bundleId",
  },
  {
    key: "teamId",
    flag: "--team-id",
    question: "Apple Team ID (developer.apple.com → Membership)",
    fallback: () => undefined,
  },
  {
    key: "linkDomains",
    flag: "--link-domain",
    question:
      "Your link domains (comma-separated, '-' for none: opengame.org/play/<appId> always works)",
    fallback: (so) => (so.gameUrl ? defaultLinkDomains(so.gameUrl).join(",") || "-" : undefined),
    dependsOn: "gameUrl",
  },
  {
    key: "branding",
    flag: "--branding",
    question: "Branding: hidden, or powered-by (a small 'Powered by OGS' mark)",
    fallback: () => "hidden",
  },
];

export interface PromptIO {
  /** Asks one question; `fallback` is the default an empty reply takes. */
  ask: (question: string, fallback?: string) => Promise<string>;
  warn?: (message: string) => void;
}

export type CollectResult = { ok: true; answers: Answers } | { ok: false; error: string };

/** Turns a raw reply or flag into the value its field holds. */
function toValue(key: Field["key"], raw: string | string[]): unknown {
  if (key !== "linkDomains") return raw;
  if (Array.isArray(raw)) return raw;
  return raw.trim() === "-" ? [] : splitList([raw]);
}

function check(key: Field["key"], value: unknown) {
  return AnswersSchema.shape[key].safeParse(value);
}

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "is not valid";

/**
 * Fills every answer from the flags; asks for the rest (or, with --yes, takes the defaults and
 * fails on what has none). Each answer is validated as it comes in.
 */
export async function collectAnswers(args: Args, io: PromptIO): Promise<CollectResult> {
  const so: Partial<Record<AnswerKey, unknown>> = {};
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const field of FIELDS) {
    const given = args[field.key];
    const fallback = field.fallback(answered(so));
    if (given !== undefined) {
      const parsed = check(field.key, toValue(field.key, given));
      if (parsed.success) {
        so[field.key] = parsed.data;
        continue;
      }
      if (args.yes) {
        invalid.push(`${field.flag} ${firstIssue(parsed.error)}`);
        continue;
      }
    } else if (args.yes) {
      const blocked = field.dependsOn !== undefined && so[field.dependsOn] === undefined;
      if (fallback === undefined && !blocked) missing.push(field.flag);
      else if (fallback !== undefined)
        so[field.key] = check(field.key, toValue(field.key, fallback)).data;
      continue;
    }
    so[field.key] = await askUntilValid(field, fallback, io);
  }

  if (missing.length > 0 || invalid.length > 0) {
    const lines = [
      ...(missing.length > 0 ? [`--yes needs ${missing.join(", ")}`] : []),
      ...invalid,
    ];
    return { ok: false, error: lines.join("\n") };
  }
  const answers = AnswersSchema.safeParse({ ...so, shellVersion: args.shellVersion });
  if (!answers.success) return { ok: false, error: firstIssue(answers.error) };
  return { ok: true, answers: answers.data };
}

/** The answers so far, as far as the defaults of later fields need them. */
function answered(so: Partial<Record<AnswerKey, unknown>>): Partial<Answers> {
  const partial = AnswersSchema.partial().safeParse(so);
  return partial.success ? partial.data : {};
}

async function askUntilValid(field: Field, fallback: string | undefined, io: PromptIO) {
  for (;;) {
    const reply = (await io.ask(field.question, fallback)).trim();
    const raw = reply === "" && fallback !== undefined ? fallback : reply;
    const parsed = check(field.key, toValue(field.key, raw));
    if (parsed.success) return parsed.data;
    io.warn?.(`${field.question.split(" (")[0]} ${firstIssue(parsed.error)}`);
  }
}
