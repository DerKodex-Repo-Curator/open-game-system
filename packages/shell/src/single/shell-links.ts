/**
 * Which incoming link (universal link, App Link, push URL) opens in the game's WebView, and at
 * what URL. Single-game apps only:
 * - `https://opengame.org/play/<appId>/<rest>` → the game's origin + `/<rest>` (query and hash kept),
 *   the fallback link domain every shell app has;
 * - any https URL on a configured link domain → as it is;
 * - an https URL on the game's own origin (push links) → as it is;
 * - anything else → null (the shell ignores it).
 *
 * Parsed by hand: React Native's `URL` is incomplete.
 */
export interface ShellLinkConfig {
  appId: string;
  gameUrl: string;
  linkDomains: readonly string[];
}

const OGS_HOSTS = ["opengame.org", "www.opengame.org"];

interface HttpsParts {
  /** Lowercased host with its port, e.g. `localhost:5173`. */
  authority: string;
  host: string;
  /** Path, query and hash: everything after the authority ("" or starting with / ? #). */
  rest: string;
}

function httpsParts(url: string): HttpsParts | null {
  const m = /^https:\/\/([^/?#]+)(.*)$/i.exec(url);
  if (!m) return null;
  const authority = (m[1] ?? "").toLowerCase();
  if (authority.includes("@")) return null;
  const host = authority.replace(/:\d+$/, "");
  return { authority, host, rest: m[2] ?? "" };
}

function playRest(rest: string, appId: string): string | null {
  const prefix = `/play/${appId}`;
  if (!rest.startsWith(prefix)) return null;
  const after = rest.slice(prefix.length);
  if (after === "") return "/";
  const next = after[0];
  if (next === "/") return after;
  if (next === "?" || next === "#") return `/${after}`;
  return null;
}

export function webViewUrlFor(incoming: string, config: ShellLinkConfig): string | null {
  const link = httpsParts(incoming);
  const game = httpsParts(config.gameUrl);
  if (!link || !game) return null;
  if (OGS_HOSTS.includes(link.host)) {
    const rest = playRest(link.rest, config.appId);
    return rest === null ? null : `https://${game.authority}${rest}`;
  }
  const domains = config.linkDomains.map((d) => d.toLowerCase());
  if (link.authority === link.host && domains.includes(link.host)) return incoming;
  if (link.authority === game.authority) return incoming;
  return null;
}
