import http, { type IncomingHttpHeaders, type Server } from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createPhoneProxy } from "./proxy";

/**
 * One fake phone's proxy (`ogs dev`) in front of a stand-in game: the headers each side sees, and
 * WebSocket upgrades (a game's room socket, Vite's HMR) passed straight through.
 */
const servers: Server[] = [];
const sockets: net.Socket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

const portOf = (server: Server) => {
  const addr = server.address();
  return typeof addr === "object" && addr ? addr.port : 0;
};

async function listening(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return portOf(server);
}

type Game = { origin: string; seen: IncomingHttpHeaders[] };

/** A game that answers each path as `routes` says, and upgrades /ws to an echo socket. */
async function game(
  routes: Record<string, (res: http.ServerResponse) => void> = {},
  onUpgrade?: (socket: net.Socket, head: Buffer) => void,
): Promise<Game> {
  const seen: IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    const route = routes[req.url ?? "/"];
    if (route) route(res);
    else {
      res.writeHead(404);
      res.end();
    }
  });
  server.on("upgrade", (req, socket: net.Socket, head: Buffer) => {
    seen.push(req.headers);
    sockets.push(socket);
    socket.on("error", () => {});
    if (onUpgrade) onUpgrade(socket, head);
    else {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Game: yes\r\n\r\n",
      );
      if (head.length) socket.write(Buffer.concat([Buffer.from("head:"), head]));
      socket.on("data", (d) => socket.write(Buffer.concat([Buffer.from("echo:"), d])));
    }
  });
  return { origin: `http://127.0.0.1:${await listening(server)}`, seen };
}

async function proxyOf(g: Game, script = "<script>bridge</script>") {
  const proxy = createPhoneProxy({ upstream: new URL(g.origin), script: async () => script });
  const port = await listening(proxy.server);
  return `http://127.0.0.1:${port}`;
}

/** A raw request to the proxy; resolves with everything read until `done` says it's enough. */
function raw(
  url: string,
  request: string,
  done: (text: string) => boolean,
): Promise<{ text: string; socket: net.Socket }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), hostname, () => socket.write(request));
    sockets.push(socket);
    let text = "";
    const finish = () => resolve({ text, socket });
    socket.on("data", (d) => {
      text += d.toString("utf8");
      if (done(text)) finish();
    });
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", reject);
  });
}

const upgradeRequest = (path: string, extra = "") =>
  `GET ${path} HTTP/1.1\r\nHost: phone.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n${extra}`;

describe("the phone proxy", { timeout: 20_000 }, () => {
  it("answers a page with the bridge first, its length, and no caching", async () => {
    const g = await game({
      "/": (res) => {
        res.writeHead(201, { "content-type": "text/html", "x-game": "kept" });
        res.end("<head></head>é");
      },
    });
    const res = await fetch(await proxyOf(g, "<script>ü</script>"));
    const body = await res.text();
    expect(res.status).toBe(201);
    expect(body).toBe("<head><script>ü</script></head>é");
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(body)));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-game")).toBe("kept");
  });

  it("passes anything that isn't HTML through as it is, status and headers", async () => {
    const g = await game({
      "/a.json": (res) => {
        res.writeHead(203, { "content-type": "application/json", "x-game": "kept" });
        res.end('{"a":1}');
      },
      "/none": (res) => {
        res.writeHead(200, { "x-game": "no type" });
        res.end("<head></head>");
      },
    });
    const proxy = await proxyOf(g);
    const json = await fetch(`${proxy}/a.json`);
    expect(json.status).toBe(203);
    expect(json.headers.get("x-game")).toBe("kept");
    expect(json.headers.get("cache-control")).toBeNull();
    expect(await json.text()).toBe('{"a":1}');
    expect(await (await fetch(`${proxy}/none`)).text()).toBe("<head></head>");
  });

  it("drops the headers that would stop framing or the injected script", async () => {
    const g = await game({
      "/": (res) => {
        res.writeHead(200, {
          "content-type": "text/html",
          "x-frame-options": "DENY",
          "content-security-policy": "frame-ancestors 'none'",
          "content-security-policy-report-only": "script-src 'none'",
          connection: "close",
        });
        res.end("<head></head>");
      },
    });
    const res = await fetch(await proxyOf(g));
    for (const h of [
      "x-frame-options",
      "content-security-policy",
      "content-security-policy-report-only",
      "content-encoding",
      "transfer-encoding",
    ])
      expect(res.headers.get(h), h).toBeNull();
  });

  it("sends the game its own host, origin and referer, and asks for no compression", async () => {
    const g = await game({
      "/": (res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      },
    });
    const proxy = await proxyOf(g);
    const host = new URL(proxy).host;
    await raw(
      proxy,
      `GET / HTTP/1.1\r\nHost: ${host}\r\nOrigin: http://${host}\r\nReferer: http://${host}/lobby?x=1\r\nAccept-Encoding: gzip\r\nConnection: close\r\n\r\n`,
      (t) => t.endsWith("ok"),
    );
    expect(g.seen.at(-1)).toMatchObject({
      host: new URL(g.origin).host,
      origin: g.origin,
      referer: `${g.origin}/lobby?x=1`,
      "accept-encoding": "identity",
    });
  });

  it("leaves another site's origin and referer alone", async () => {
    const g = await game({
      "/": (res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      },
    });
    const proxy = await proxyOf(g);
    await raw(
      proxy,
      `GET / HTTP/1.1\r\nHost: ${new URL(proxy).host}\r\nOrigin: https://elsewhere.test\r\nReferer: https://elsewhere.test/x\r\nConnection: close\r\n\r\n`,
      (t) => t.endsWith("ok"),
    );
    expect(g.seen.at(-1)).toMatchObject({
      origin: "https://elsewhere.test",
      referer: "https://elsewhere.test/x",
    });
  });

  it("without a Host header it calls itself localhost", async () => {
    const g = await game({
      "/": (res) => {
        res.writeHead(302, { location: "/next" });
        res.end();
      },
    });
    const proxy = await proxyOf(g);
    const { text } = await raw(proxy, "GET / HTTP/1.0\r\n\r\n", (t) => t.includes("\r\n\r\n"));
    expect(text).toMatch(/\r\nlocation: http:\/\/localhost\/next\r\n/i);
  });

  it("keeps redirects on the game's origin in the phone; others, and nonsense, as they are", async () => {
    const g = await game({
      "/same": (res) => {
        res.writeHead(302, { location: "/play?x=1#top" });
        res.end();
      },
      "/other": (res) => {
        res.writeHead(302, { location: "https://elsewhere.test/a" });
        res.end();
      },
      "/bad": (res) => {
        res.writeHead(302, { location: "http://[" });
        res.end();
      },
    });
    const proxy = await proxyOf(g);
    const location = async (path: string) =>
      (await fetch(`${proxy}${path}`, { redirect: "manual" })).headers.get("location");
    expect(await location("/same")).toBe(`${proxy}/play?x=1#top`);
    expect(await location("/other")).toBe("https://elsewhere.test/a");
    expect(await location("/bad")).toBe("http://[");
  });

  it("says the game didn't answer when it's down", async () => {
    const g = await game();
    const proxy = await proxyOf(g);
    const s = servers[0];
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
    const res = await fetch(proxy);
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toMatch(
      new RegExp(
        `^ogs dev: the game at ${g.origin.replace(/\./g, "\\.")} did not answer \\(.+\\)\\. Is its dev server running\\?$`,
      ),
    );
  });

  it("passes a WebSocket upgrade straight through, both ways, with the game's headers", async () => {
    const g = await game();
    const proxy = await proxyOf(g);
    const { text, socket } = await raw(proxy, upgradeRequest("/ws", "first"), (t) =>
      t.includes("echo:first"),
    );
    expect(text.startsWith("HTTP/1.1 101 Switching Protocols\r\n")).toBe(true);
    expect(text).toMatch(/\r\nX-Game: yes\r\n/);
    expect(text).toContain("\r\n\r\n");
    expect(text.split("\r\n\r\n")[0]).not.toMatch(/undefined/);
    expect(g.seen.at(-1)?.host).toBe(new URL(g.origin).host);
    const more = new Promise<string>((r) => socket.once("data", (d) => r(d.toString())));
    socket.write("again");
    expect(await more).toBe("echo:again");
    socket.destroy();
  });

  it("passes on what the game sends with its upgrade answer", async () => {
    const g = await game({}, (socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello",
      );
    });
    const proxy = await proxyOf(g);
    const { text, socket } = await raw(proxy, upgradeRequest("/ws"), (t) => t.endsWith("hello"));
    expect(text).toBe(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello",
    );
    socket.destroy();
  });

  it("an upgrade the game refuses ends with the game's status", async () => {
    const g = await game({}, (socket) => {
      socket.end("HTTP/1.1 403 Nope\r\nContent-Length: 0\r\n\r\n");
    });
    const proxy = await proxyOf(g);
    const { text } = await raw(proxy, upgradeRequest("/ws"), () => false);
    expect(text).toBe("HTTP/1.1 403 Nope\r\n\r\n");
  });

  it("an upgrade with the game down closes the socket", async () => {
    const g = await game();
    const proxy = await proxyOf(g);
    const s = servers[0];
    await new Promise<void>((r) => s.close(() => r()));
    const { text } = await raw(proxy, upgradeRequest("/ws"), () => false);
    expect(text).toBe("");
  });

  it("a game socket that fails closes the phone's, and the other way round", async () => {
    let gameSocket: net.Socket | undefined;
    const g = await game({}, (socket) => {
      gameSocket = socket;
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
    });
    const proxy = await proxyOf(g);
    const { socket } = await raw(proxy, upgradeRequest("/ws"), (t) => t.includes("\r\n\r\n"));
    const closed = new Promise<void>((r) => socket.on("close", () => r()));
    gameSocket?.resetAndDestroy();
    await closed;
    expect(socket.destroyed).toBe(true);
  });

  it("a phone socket that fails closes the game's", async () => {
    let gameClosed: Promise<void> = Promise.resolve();
    const g = await game({}, (socket) => {
      gameClosed = new Promise((r) => socket.on("end", () => r()));
      socket.resume();
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
    });
    const proxy = await proxyOf(g);
    const { socket } = await raw(proxy, upgradeRequest("/ws"), (t) => t.includes("\r\n\r\n"));
    socket.resetAndDestroy();
    await gameClosed;
  });

  it("speaks TLS to an https game (here, a plain one: so it fails)", async () => {
    const g = await game({
      "/": (res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      },
    });
    const plain = await proxyOf(g);
    expect(await (await fetch(plain)).text()).toBe("ok");
    const tls = createPhoneProxy({
      upstream: new URL(g.origin.replace("http:", "https:")),
      script: async () => "",
    });
    const port = await listening(tls.server);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(502);
    const { text } = await raw(`http://127.0.0.1:${port}`, upgradeRequest("/ws"), () => false);
    expect(text).toBe("");
  });
});
