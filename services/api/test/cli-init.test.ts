import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ManifestSchema } from "@open-game-system/ogs-protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { type Io, run } from "../../../packages/cli/src/cli";
import app from "../src/index";

/**
 * The seam between `ogs init` and the API (docs/acceptance/2026-10-18-ogs-developer-tool.feature,
 * "Adding OGS to an existing web game"): the real CLI against the real GET /api/v1/dev/kits, on small
 * fixture repos in a temp dir. Only the kit downloads (the docs site's /pkg/*.tgz) are stand-ins.
 */
const API = "https://api.test";
const TGZ = new Uint8Array([0x1f, 0x8b, 8, 0, 0x6f, 0x67, 0x73]);
let root: string;
let out: string[];
let err: string[];
let downloads: string[];

/** Small game repos, as files. */
const page = (src: string) =>
  `<!doctype html>\n<html><body><canvas></canvas><script type="module" src="${src}"></script></body></html>\n`;
const FIXTURES: Record<string, Record<string, string>> = {
  /** A Vite game with a TV page and a phone page (pnpm). */
  "vite-two-pages": {
    "package.json": `${JSON.stringify(
      {
        name: "comet-catch",
        private: true,
        type: "module",
        scripts: { dev: "vite" },
        devDependencies: { vite: "^7.0.0" },
      },
      null,
      2,
    )}\n`,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "index.html": page("/src/main.ts"),
    "tv.html": page("/src/tv.ts"),
    "src/main.ts": `import { connect } from "./net";\n\nconnect();\n`,
    "src/tv.ts": `import { scene } from "./scene";\n\nscene.start();\n`,
  },
  /** A plain HTML game: no bundler, no lockfile. */
  "plain-html": {
    "package.json": `${JSON.stringify({ name: "star-sort", scripts: { start: "npx serve ." } }, null, 2)}\n`,
    "index.html": `<!doctype html>\n<script src="phone.js"></script>\n`,
    "tv.html": `<!doctype html>\n<script src="tv.js"></script>\n`,
    "phone.js": "join();\n",
    "tv.js": "draw();\n",
  },
  /** A Vite game with one page for everything (npm): nothing to patch blindly. */
  "vite-one-page": {
    "package.json": `${JSON.stringify({ name: "moon-maze", devDependencies: { vite: "^7.0.0" } }, null, 2)}\n`,
    "package-lock.json": "{}\n",
    "index.html": page("/src/main.ts"),
    "src/main.ts": "start();\n",
  },
};

function fixture(name: string) {
  for (const [path, content] of Object.entries(FIXTURES[name] ?? {})) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}
const read = (path: string) => readFileSync(join(root, path), "utf8");
const snapshot = () =>
  Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => [join(d.parentPath, d.name), readFileSync(join(d.parentPath, d.name), "utf8")]),
  );

const io = (env: Record<string, string> = {}): Io => ({
  env: { OGS_API: API, OGS_CONFIG_DIR: join(root, ".ogs-config") },
  stdout: (s) => out.push(s),
  stderr: (s) => err.push(s),
  readFile: (p) => readFileSync(p, "utf8"),
  fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === API) return app.request(`${url.pathname}${url.search}`, init, env);
    downloads.push(url.href);
    return url.pathname.startsWith("/pkg/") && url.pathname.endsWith(".tgz")
      ? new Response(TGZ)
      : new Response("not found", { status: 404 });
  },
  cwd: () => root,
  isTTY: false,
});

const FLAGS = [
  "--app-id",
  "comet-catch",
  "--name",
  "Comet Catch",
  "--start-url",
  "https://comet.example/",
];
const KITS = ["profile-kit", "cast-kit-core", "cast-kit-react", "try-kit"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ogs-init-seam-"));
  out = [];
  err = [];
  downloads = [];
});

describe("ogs init against the API", { timeout: 20_000 }, () => {
  it("a Vite game: manifest, the kits /dev/kits lists, deps, OGS.md and the codemod", async () => {
    fixture("vite-two-pages");
    const code = await run(
      ["init", ...FLAGS, "--codemod"],
      io({ OGS_DOCS_BASE: "https://docs.test" }),
    );
    expect(err).toEqual([]);
    expect(code).toBe(0);

    expect(ManifestSchema.safeParse(JSON.parse(read("ogs.manifest.json"))).success).toBe(true);
    expect(downloads).toEqual(KITS.map((k) => `https://docs.test/pkg/${k}.tgz`));
    for (const k of KITS)
      expect(new Uint8Array(readFileSync(join(root, `vendor/${k}.tgz`)))).toEqual(TGZ);
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies).toEqual(
      Object.fromEntries(KITS.map((k) => [`@open-game-system/${k}`, `file:vendor/${k}.tgz`])),
    );
    expect(pkg.scripts).toEqual({ dev: "vite" });

    const md = read("OGS.md");
    expect(md).toContain("https://docs.test/llms.txt");
    expect(md).toContain("Follow the step-by-step checklist at\nhttps://docs.test/quickstart.md");
    expect(md).toContain("Run `pnpm install`");

    expect(read("src/tv.ts")).toContain("getOgsSessionSource();");
    expect(read("src/tv.ts")).toMatch(/^import \{ scene \} from "\.\/scene";\n\/\/ OGS/);
    expect(read("src/main.ts")).toContain("getOgsProfileSource()");
    expect(out.join("\n")).toContain("Next: pnpm install");
  });

  it("--dry: the plan from the real kit list, and the repo is unchanged", async () => {
    fixture("vite-two-pages");
    const before = snapshot();
    expect(await run(["init", ...FLAGS, "--codemod", "--dry"], io())).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(downloads).toEqual([]);
    const plan = out.join("\n");
    expect(plan).toContain(
      "write  vendor/profile-kit.tgz  (https://ogs-docs.pages.dev/pkg/profile-kit.tgz)",
    );
    expect(plan).toContain("edit   src/tv.ts  (the TV page's launcher hookup)");
    expect(plan).toContain("Dry run: nothing changed.");
  });

  it("a plain HTML game: the kits and manifest, and the snippets printed (no HTML is touched)", async () => {
    fixture("plain-html");
    const html = [read("index.html"), read("tv.html"), read("phone.js"), read("tv.js")];
    expect(await run(["init", ...FLAGS, "--codemod"], io())).toBe(0);
    expect([read("index.html"), read("tv.html"), read("phone.js"), read("tv.js")]).toEqual(html);
    expect(JSON.parse(read("package.json")).dependencies["@open-game-system/profile-kit"]).toBe(
      "file:vendor/profile-kit.tgz",
    );
    const text = out.join("\n");
    expect(text).toContain("plain HTML game, npm (no lockfile)");
    expect(text).toContain("import map");
    expect(read("OGS.md")).toContain("**Plain HTML:**");
  });

  it("a one-page Vite game: neither entry is patched, both snippets say where they go", async () => {
    fixture("vite-one-page");
    expect(await run(["init", ...FLAGS, "--codemod"], io())).toBe(0);
    expect(read("src/main.ts")).toBe("start();\n");
    const text = out.join("\n");
    expect(text).toContain("Vite game, npm (package-lock.json)");
    expect(text).toContain(
      "The TV page's launcher hookup: add this at the top of the module that boots your TV page",
    );
    expect(text).toContain(
      "The phone page's profile hookup: add this at the top of the module that boots your phone page",
    );
  });

  it("a misconfigured docs base: the API's error, and nothing written", async () => {
    fixture("vite-one-page");
    const before = snapshot();
    expect(await run(["init", ...FLAGS], io({ OGS_DOCS_BASE: "nope" }))).toBe(1);
    expect(err.join("\n")).toContain("docs_base_invalid");
    expect(snapshot()).toEqual(before);
  });
});
