import { type Manifest, ManifestSchema } from "@open-game-system/ogs-protocol";

/**
 * POST /api/v1/manifests/check and ogs publish (docs/design-docs/ogs-cli.md): a manifest's schema
 * issues, the catalogue's rules as warnings (apps/docs/content/rules.md), and live checks of its
 * pages. The network is the `Probe`, so tests never reach it.
 */

/** One GET's status and headers, or null when there was no answer (timeout, DNS, TLS). */
export type Probe = (url: string) => Promise<{ status: number; headers: Headers } | null>;

export type ManifestIssue = { path: string; message: string };
export type ManifestWarning = { code: string; message: string };
export type ManifestCheck = {
  valid: boolean;
  issues: ManifestIssue[];
  warnings: ManifestWarning[];
  checked: { startUrl?: number; tvUrl?: number; frameable?: boolean };
};

export const PROBE_TIMEOUT_MS = 5000;

/** The real probe: one GET, redirects not followed, 5 s, the body never read. */
export const fetchProbe: Probe = async (url) => {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return { status: res.status, headers: res.headers };
  } catch {
    return null;
  }
};

/** The OGS TV launcher, which frames every game's TV page. */
export const LAUNCHER_ORIGIN = "https://tv.opengame.org";

/** Whether one CSP frame-ancestors source expression lets the launcher frame the page. */
function allowsLauncher(source: string): boolean {
  const launcher = new URL(LAUNCHER_ORIGIN);
  const s = source.toLowerCase().replace(/\/+$/, "");
  if (s === "*") return true;
  if (s.endsWith(":") && !s.includes("/")) return s === launcher.protocol;
  const match = s.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([a-z0-9.-]+)(?::(\d+|\*))?$/);
  if (!match) return false;
  const [, scheme, wildcard, host, port] = match;
  if (scheme && scheme !== launcher.protocol.slice(0, -1)) return false;
  if (port && port !== "*" && port !== "443") return false;
  return wildcard ? launcher.hostname.endsWith(`.${host}`) : launcher.hostname === host;
}

/**
 * Whether the OGS launcher may frame a page with these headers: CSP frame-ancestors decides when
 * present (browsers then ignore X-Frame-Options); otherwise X-Frame-Options DENY / SAMEORIGIN block.
 */
export function frameable(headers: Headers): boolean {
  const ancestors = (headers.get("content-security-policy") ?? "")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([name]) => name?.toLowerCase() === "frame-ancestors");
  if (ancestors) return ancestors.slice(1).some(allowsLauncher);
  const xfo = (headers.get("x-frame-options") ?? "").trim().toLowerCase();
  return xfo !== "deny" && xfo !== "sameorigin";
}

const ART_KIT = ["icon", "cover", "logo", "heroClean"] as const;

/** The catalogue's rules (services/api/test/catalogue.test.ts), as warnings: they never block. */
export function catalogueWarnings(m: Manifest): ManifestWarning[] {
  const warnings: ManifestWarning[] = [];
  if (new URL(m.startUrl).protocol !== "https:")
    warnings.push({
      code: "start_url_not_https",
      message: "startUrl must be https for the OGS app to open it",
    });
  const missing = ART_KIT.filter((k) => !m.art[k]);
  if (missing.length > 0)
    warnings.push({ code: "missing_art", message: `The art kit is missing ${missing.join(", ")}` });
  const forGrownUps = m.roles.length > 0 && m.roles.every((r) => r.audience === "grownup");
  if (!forGrownUps && !m.roles.some((r) => r.audience === "kid"))
    warnings.push({
      code: "no_kid_role",
      message: "No role has audience kid (a game for grown-ups gives every role audience grownup)",
    });
  return warnings;
}

/** The manifest, or its ManifestSchema issues (each path joined with "."). */
export function parseManifest(raw: unknown): { manifest: Manifest } | { issues: ManifestIssue[] } {
  const parsed = ManifestSchema.safeParse(raw);
  return parsed.success
    ? { manifest: parsed.data }
    : { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

const reachable = (status: number) => status >= 200 && status < 400;

/** Schema, then (for a valid manifest) the catalogue rules and the live checks. */
export async function checkManifest(raw: unknown, probe: Probe): Promise<ManifestCheck> {
  const parsed = parseManifest(raw);
  if ("issues" in parsed) return { valid: false, issues: parsed.issues, warnings: [], checked: {} };
  const m = parsed.manifest;
  const warnings = catalogueWarnings(m);
  const checked: ManifestCheck["checked"] = {};
  const [start, tv] = await Promise.all([probe(m.startUrl), m.tvUrl ? probe(m.tvUrl) : null]);
  if (start) checked.startUrl = start.status;
  if (!start || !reachable(start.status))
    warnings.push({
      code: "start_url_unreachable",
      message: start ? `startUrl answered ${start.status}` : "startUrl didn't answer within 5 s",
    });
  if (tv) {
    checked.tvUrl = tv.status;
    checked.frameable = frameable(tv.headers);
    if (!checked.frameable)
      warnings.push({
        code: "tv_page_not_frameable",
        message: `tvUrl's X-Frame-Options or CSP frame-ancestors keeps the OGS launcher (${LAUNCHER_ORIGIN}) from framing it`,
      });
  }
  return { valid: true, issues: [], warnings, checked };
}
