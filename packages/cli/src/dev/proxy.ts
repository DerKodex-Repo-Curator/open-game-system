import http, { type IncomingHttpHeaders, type IncomingMessage, type Server } from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import { injectBridge } from "./bridge-script";

/** Headers that would stop the harness framing the page or running the injected bridge. */
const DROPPED = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

const clientFor = (url: URL) => (url.protocol === "https:" ? https : http);

/** The request's headers as the game's server should see them: its own host and origin. */
function upstreamHeaders(req: IncomingMessage, upstream: URL, self: string): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = { ...req.headers, host: upstream.host };
  headers["accept-encoding"] = "identity";
  if (headers.origin === self) headers.origin = upstream.origin;
  if (typeof headers.referer === "string" && headers.referer.startsWith(self))
    headers.referer = upstream.origin + headers.referer.slice(self.length);
  return headers;
}

/** A Location on the game's own origin points back through this proxy. */
function rewriteLocation(location: string, upstream: URL, self: string): string {
  try {
    const to = new URL(location, upstream);
    return to.origin === upstream.origin ? self + to.pathname + to.search + to.hash : location;
  } catch {
    return location;
  }
}

/** The game's response headers as the phone gets them: without DROPPED, redirects kept on this proxy. */
function downstreamHeaders(
  upHeaders: IncomingHttpHeaders,
  upstream: URL,
  self: string,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(upHeaders)) {
    if (DROPPED.has(k)) continue;
    // Stryker disable next-line ConditionalExpression: equivalent, Node never gives a header as undefined
    if (v === undefined) continue;
    // Node gives Location as one string.
    headers[k] = k === "location" ? rewriteLocation(String(v), upstream, self) : v;
  }
  return headers;
}

/**
 * One fake phone: a proxy of the game's start URL origin on its own port (so each phone has its
 * own origin, storage and profile, like a separate device), with the fake app bridge injected into
 * every HTML page. WebSockets (a game's room socket, Vite's HMR) pass straight through.
 */
export function createPhoneProxy(opts: { upstream: URL; script: () => Promise<string> }): {
  server: Server;
} {
  const { upstream, script } = opts;
  const server = http.createServer((req, res) => {
    const self = `http://${req.headers.host ?? "localhost"}`;
    // Stryker disable next-line StringLiteral: equivalent, a server's request always has its url
    const target = new URL(req.url ?? "/", upstream);
    const up = clientFor(upstream).request(
      target.href,
      { method: req.method, headers: upstreamHeaders(req, upstream, self) },
      (upRes) => {
        const headers = downstreamHeaders(upRes.headers, upstream, self);
        const isHtml = upRes.headers["content-type"]?.includes("text/html") ?? false;
        if (!isHtml) {
          res.writeHead(upRes.statusCode ?? 502, headers);
          upRes.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        upRes.on("data", (c: Buffer) => chunks.push(c));
        upRes.on("end", async () => {
          const body = injectBridge(Buffer.concat(chunks).toString("utf8"), await script());
          res.writeHead(upRes.statusCode ?? 200, {
            ...headers,
            "content-length": Buffer.byteLength(body),
            "cache-control": "no-store",
          });
          res.end(body);
        });
      },
    );
    up.on("error", (e) => {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        `ogs dev: the game at ${upstream.origin} did not answer (${e.message}). Is its dev server running?`,
      );
    });
    req.pipe(up);
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const self = `http://${req.headers.host ?? "localhost"}`;
    // Stryker disable next-line LogicalOperator,StringLiteral: equivalent, a server's request always has its url
    const up = clientFor(upstream).request(new URL(req.url ?? "/", upstream).href, {
      method: req.method,
      headers: upstreamHeaders(req, upstream, self),
    });
    up.on("upgrade", (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`];
      for (let i = 0; i < upRes.rawHeaders.length; i += 2)
        lines.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`);
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      // What either side sent after its headers (often nothing: writing nothing is fine).
      socket.write(upHead);
      upSocket.write(head);
      upSocket.pipe(socket).pipe(upSocket);
      upSocket.on("error", () => socket.destroy());
      socket.on("error", () => upSocket.destroy());
    });
    up.on("response", (upRes) => {
      socket.end(`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n\r\n`);
    });
    up.on("error", () => socket.destroy());
    up.end();
  });

  return { server };
}
