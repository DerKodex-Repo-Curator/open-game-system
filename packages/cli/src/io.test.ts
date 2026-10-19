import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  CliError,
  call,
  configDir,
  files,
  getJson,
  type Io,
  list,
  readCredentials,
  saveCredentials,
  session,
} from "./io";

/** What every command shares: the file system, the saved login and the API client. */
let dir: string;
let requests: { url: string; init?: RequestInit }[];
let answer: () => Response;

function io(env: Record<string, string | undefined> = {}, over: Partial<Io> = {}): Io {
  return {
    env: { OGS_CONFIG_DIR: dir, ...env },
    stdout: () => {},
    stderr: () => {},
    readFile: (p) => readFileSync(p, "utf8"),
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      return answer();
    },
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ogs-io-"));
  requests = [];
  answer = () => Response.json({ ok: true });
});

describe("files", () => {
  it("uses node:fs and the process's folder for what io leaves out", () => {
    const fs = files(io());
    expect(fs.cwd).toBe(process.cwd());
    const path = join(dir, "a", "b", "c.txt");
    fs.write(path, "hello");
    expect(readFileSync(path, "utf8")).toBe("hello");
    expect(fs.exists(path)).toBe(true);
    expect(fs.exists(join(dir, "nope"))).toBe(false);
    expect(fs.list(join(dir, "a"))).toEqual(["b"]);
    expect(fs.list(join(dir, "nope"))).toEqual([]);
    expect(fs.read(path)).toBe("hello");
  });

  it("uses io's own when given", () => {
    const writes: string[] = [];
    const fs = files(
      io(
        {},
        {
          cwd: () => "/repo",
          writeFile: (p) => writes.push(p),
          exists: (p) => p === "/x",
          listDir: () => ["only"],
        },
      ),
    );
    expect(fs.cwd).toBe("/repo");
    fs.write("/repo/f", "data");
    expect(writes).toEqual(["/repo/f"]);
    expect(existsSync("/repo/f")).toBe(false);
    expect(fs.exists("/x")).toBe(true);
    expect(fs.list("/anything")).toEqual(["only"]);
  });
});

describe("the saved login", () => {
  it("lives in OGS_CONFIG_DIR, else ~/.config/ogs under HOME, else the user's home", () => {
    expect(configDir(io())).toBe(dir);
    expect(configDir(io({ OGS_CONFIG_DIR: undefined, HOME: "/home/kid" }))).toBe(
      "/home/kid/.config/ogs",
    );
    expect(configDir(io({ OGS_CONFIG_DIR: undefined, HOME: undefined }))).toBe(
      join(homedir(), ".config", "ogs"),
    );
  });

  it("is saved readable by the user only, in a folder only they can open", () => {
    const nested = join(dir, "deep", "ogs");
    saveCredentials(io({ OGS_CONFIG_DIR: nested }), {
      currentApp: "a",
      apps: { a: { key: "ogsk_a" } },
    });
    const file = join(nested, "credentials.json");
    expect(readFileSync(file, "utf8")).toBe(
      `${JSON.stringify({ currentApp: "a", apps: { a: { key: "ogsk_a" } } }, null, 2)}\n`,
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(nested).mode & 0o777).toBe(0o700);
  });

  it("re-saving tightens a file that was readable by others", () => {
    const file = join(dir, "credentials.json");
    writeFileSync(file, "{}", { mode: 0o644 });
    saveCredentials(io(), { apps: {} });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("reads as empty when missing, not JSON, or of the wrong shape", () => {
    expect(readCredentials(io())).toEqual({ apps: {} });
    writeFileSync(join(dir, "credentials.json"), "not json");
    expect(readCredentials(io())).toEqual({ apps: {} });
    writeFileSync(join(dir, "credentials.json"), JSON.stringify({ apps: { a: { key: 1 } } }));
    expect(readCredentials(io())).toEqual({ apps: {} });
    writeFileSync(join(dir, "credentials.json"), JSON.stringify({ currentApp: "a" }));
    expect(readCredentials(io())).toEqual({ currentApp: "a", apps: {} });
  });

  it("session: --app, else the current app; not logged in says how", () => {
    saveCredentials(io(), {
      currentApp: "a",
      apps: { a: { key: "ogsk_a" }, b: { key: "ogsk_b" } },
    });
    expect(session(io(), undefined)).toEqual({ appId: "a", key: "ogsk_a" });
    expect(session(io(), "b")).toEqual({ appId: "b", key: "ogsk_b" });
    expect(() => session(io(), "c")).toThrow(
      new CliError("Not logged in for c. Run: ogs login --app <appId> --key <game API key>"),
    );
    saveCredentials(io(), { apps: {} });
    expect(() => session(io(), undefined)).toThrow(
      new CliError("Not logged in. Run: ogs login --app <appId> --key <game API key>"),
    );
  });
});

describe("the API client", () => {
  it("OGS_API without its trailing slashes, else the production API", () => {
    expect(api(io({ OGS_API: "https://preview.test//" }))).toBe("https://preview.test");
    expect(api(io())).toBe("https://opengame-api.jonathanrmumm.workers.dev");
  });

  it("sends the key, and JSON only when there's a body", async () => {
    const env = { OGS_API: "https://api.test/" };
    expect(await call(io(env), "PUT", "/x", "ogsk_k", { a: 1 })).toEqual({ ok: true });
    expect(await call(io(env), "GET", "/y", "ogsk_k")).toEqual({ ok: true });
    const [put, get] = requests;
    expect(put.url).toBe("https://api.test/x");
    expect(put.init?.method).toBe("PUT");
    expect(put.init?.body).toBe('{"a":1}');
    expect(new Headers(put.init?.headers).get("authorization")).toBe("Bearer ogsk_k");
    expect(new Headers(put.init?.headers).get("content-type")).toBe("application/json");
    expect(get.url).toBe("https://api.test/y");
    expect(get.init?.body).toBeUndefined();
    expect(new Headers(get.init?.headers).get("content-type")).toBeNull();
  });

  it("an empty answer is null", async () => {
    answer = () => new Response(null, { status: 204 });
    expect(await call(io(), "PUT", "/x", "k", {})).toBeNull();
  });

  it("an error: the API's code and message, the code alone, or the HTTP status", async () => {
    answer = () => Response.json({ error: { code: "nope", message: "Not that" } }, { status: 403 });
    await expect(call(io(), "GET", "/x", "k")).rejects.toThrow(new CliError("nope: Not that"));
    answer = () => Response.json({ error: { code: "nope" } }, { status: 403 });
    await expect(call(io(), "GET", "/x", "k")).rejects.toThrow(new CliError("nope:"));
    answer = () => Response.json({ other: true }, { status: 502 });
    await expect(call(io(), "GET", "/x", "k")).rejects.toThrow(new CliError("HTTP 502"));
    answer = () => new Response("", { status: 500 });
    await expect(call(io(), "GET", "/x", "k")).rejects.toThrow(new CliError("HTTP 500"));
  });

  it("getJson: the JSON, or the HTTP status", async () => {
    expect(await getJson(io(), "https://x.test/a")).toEqual({ ok: true });
    expect(requests[0].url).toBe("https://x.test/a");
    answer = () => new Response("no", { status: 404 });
    await expect(getJson(io(), "https://x.test/a")).rejects.toThrow(new CliError("HTTP 404"));
  });
});

describe("list", () => {
  it("splits on commas, trimmed, without blanks", () => {
    expect(list(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(list("")).toEqual([]);
    expect(list(undefined)).toEqual([]);
  });
});
