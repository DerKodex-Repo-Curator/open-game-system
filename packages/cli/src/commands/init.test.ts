import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ManifestSchema } from "@open-game-system/ogs-protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { type Io, run } from "../cli";

/**
 * `ogs init` (docs/design-docs/ogs-cli.md; docs/acceptance/2026-10-18-ogs-developer-tool.feature,
 * "Adding OGS to an existing web game") on repos in a temp dir, with a stand-in /dev/kits and kit
 * files. services/api/test/cli-init.test.ts runs it against the real route.
 */
const API = "https://api.test";
const DOCS = "https://docs.test";
const TGZ = new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]);
const KITS = ["profile-kit", "cast-kit-core", "cast-kit-react", "try-kit"];
let root: string;
let out: string[];
let err: string[];
let requests: string[];
let routes: Record<string, () => Response>;

const kitsBody = () => ({
  docs: DOCS,
  llms: `${DOCS}/llms.txt`,
  quickstart: `${DOCS}/quickstart.md`,
  kits: KITS.map((k) => ({
    name: `@open-game-system/${k}`,
    file: `${k}.tgz`,
    url: `${DOCS}/pkg/${k}.tgz`,
  })),
});

function io(over: Partial<Io> = {}): Io {
  return {
    env: { OGS_API: API, OGS_CONFIG_DIR: join(root, ".ogs-config") },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: (p) => readFileSync(p, "utf8"),
    fetch: async (input) => {
      const url = String(input);
      requests.push(url);
      const route = routes[url];
      return route ? route() : new Response("not found", { status: 404 });
    },
    cwd: () => root,
    isTTY: false,
    ...over,
  };
}

const put = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const read = (path: string) => readFileSync(join(root, path), "utf8");
const json = (path: string) => JSON.parse(read(path));
const page = (src: string) => `<!doctype html><script type="module" src="${src}"></script>`;
/** Every file under root, with its content: what --dry must leave alone. */
const snapshot = () =>
  Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => {
        const p = join(d.parentPath, d.name);
        return [p, readFileSync(p, "utf8")];
      }),
  );

function viteGame() {
  put(
    "package.json",
    `${JSON.stringify(
      {
        name: "comet-catch",
        private: true,
        type: "module",
        dependencies: { three: "^0.180.0" },
        devDependencies: { vite: "^7.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  put("index.html", page("/src/main.ts"));
  put("tv.html", page("/src/tv.ts"));
  put("src/main.ts", `import { joinRoom } from "./net";\n\njoinRoom();\n`);
  put("src/tv.ts", `import * as THREE from "three";\nimport "./tv.css";\n\nnew THREE.Scene();\n`);
}

const FLAGS = [
  "--app-id",
  "comet-catch",
  "--name",
  "Comet Catch",
  "--start-url",
  "https://comet.example/",
];
const init = (args: string[] = FLAGS, over: Partial<Io> = {}) => run(["init", ...args], io(over));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ogs-init-"));
  out = [];
  err = [];
  requests = [];
  routes = { [`${API}/api/v1/dev/kits`]: () => Response.json(kitsBody()) };
  for (const k of KITS) routes[`${DOCS}/pkg/${k}.tgz`] = () => new Response(TGZ);
});

describe("ogs init", () => {
  it("writes a valid ogs.manifest.json from the flags", async () => {
    viteGame();
    expect(await init()).toBe(0);
    const manifest = json("ogs.manifest.json");
    expect(ManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest).toEqual({
      appId: "comet-catch",
      name: "Comet Catch",
      shape: "couch",
      tv: "optional",
      startUrl: "https://comet.example/",
      art: {
        tile: "/art/comet-catch/tv.jpg",
        icon: "/art/comet-catch/icon.png",
        cover: "/art/comet-catch/cover.jpg",
        logo: "/art/comet-catch/logo.png",
        heroClean: "/art/comet-catch/hero-clean.jpg",
      },
    });
  });

  it("--tv-url, --shape and --tv go in the manifest; a TV page makes the TV required", async () => {
    viteGame();
    await init([...FLAGS, "--tv-url", "https://comet.example/tv.html", "--shape", "live"]);
    expect(json("ogs.manifest.json")).toMatchObject({
      tvUrl: "https://comet.example/tv.html",
      shape: "live",
      tv: "required",
    });
  });

  it("--tv says what the game needs from a TV", async () => {
    viteGame();
    await init([...FLAGS, "--tv", "none"]);
    expect(json("ogs.manifest.json").tv).toBe("none");
  });

  it("downloads every kit /dev/kits lists into vendor/ and adds file:vendor deps", async () => {
    viteGame();
    expect(await init()).toBe(0);
    for (const k of KITS)
      expect(new Uint8Array(readFileSync(join(root, "vendor", `${k}.tgz`)))).toEqual(TGZ);
    expect(json("package.json").dependencies).toEqual({
      three: "^0.180.0",
      "@open-game-system/profile-kit": "file:vendor/profile-kit.tgz",
      "@open-game-system/cast-kit-core": "file:vendor/cast-kit-core.tgz",
      "@open-game-system/cast-kit-react": "file:vendor/cast-kit-react.tgz",
      "@open-game-system/try-kit": "file:vendor/try-kit.tgz",
    });
    expect(json("package.json").devDependencies).toEqual({ vite: "^7.0.0" });
    expect(read("package.json").endsWith("}\n")).toBe(true);
  });

  it("prints the install command for the repo's package manager and never runs it", async () => {
    viteGame();
    await init();
    expect(out.join("\n")).toContain("Vite game, pnpm (pnpm-lock.yaml)");
    expect(out.join("\n")).toContain("Next: pnpm install");
  });

  it("writes OGS.md for this repo with the agent prompt and the llms.txt link", async () => {
    viteGame();
    await init();
    const md = read("OGS.md");
    expect(md).toContain("# OGS for Comet Catch");
    expect(md).toContain("## Prompt for your agent");
    expect(md).toContain(`${DOCS}/llms.txt`);
    expect(md).toContain("Run `pnpm install`");
    expect(md).toContain("TV entry: `src/tv.ts`");
    expect(md).toContain("Phone entry: `src/main.ts`");
  });

  it("--dry changes nothing, downloads nothing and prints the plan", async () => {
    viteGame();
    const before = snapshot();
    expect(await init([...FLAGS, "--dry", "--codemod"])).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(requests).toEqual([`${API}/api/v1/dev/kits`]);
    const plan = out.join("\n");
    expect(plan).toContain("write  ogs.manifest.json");
    expect(plan).toContain(`write  vendor/profile-kit.tgz  (${DOCS}/pkg/profile-kit.tgz)`);
    expect(plan).toContain(
      "edit   package.json  (+ @open-game-system/profile-kit, @open-game-system/cast-kit-core, @open-game-system/cast-kit-react, @open-game-system/try-kit)",
    );
    expect(plan).toContain("write  OGS.md");
    expect(plan).toContain("edit   src/tv.ts  (the TV page's launcher hookup)");
    expect(plan).toContain("edit   src/main.ts  (the phone page's profile hookup)");
    expect(plan).toContain("Dry run: nothing changed.");
  });

  it("with no terminal and missing flags: exit 2, says what's missing, touches nothing", async () => {
    viteGame();
    const before = snapshot();
    expect(await init(["--name", "Comet Catch"])).toBe(2);
    expect(err.join("\n")).toContain("missing --app-id, --start-url");
    expect(snapshot()).toEqual(before);
    expect(requests).toEqual([]);
  });

  it("at a terminal it asks for what the flags left out", async () => {
    viteGame();
    const answers: Record<string, string> = {
      appId: "comet-catch",
      "Start URL": "https://comet.example/",
      "TV page URL": "https://comet.example/tv.html",
    };
    const asked: string[] = [];
    const prompt = async (q: string) => {
      asked.push(q);
      return Object.entries(answers).find(([k]) => q.startsWith(k))?.[1] ?? "";
    };
    expect(await init(["--name", "Comet Catch"], { isTTY: true, prompt })).toBe(0);
    expect(asked).toHaveLength(3);
    expect(json("ogs.manifest.json")).toMatchObject({
      appId: "comet-catch",
      name: "Comet Catch",
      tvUrl: "https://comet.example/tv.html",
    });
  });

  it("a flag the manifest schema refuses: exit 2 with the schema's issue", async () => {
    viteGame();
    expect(await init(["--app-id", "Comet Catch", ...FLAGS.slice(2)])).toBe(2);
    expect(err.join("\n")).toMatch(/appId: /);
    expect(await init([...FLAGS, "--shape", "party"])).toBe(2);
    expect(err.join("\n")).toMatch(/shape: /);
    expect(await init([...FLAGS, "--nope"])).toBe(2);
  });

  it("keeps an existing valid ogs.manifest.json (no flags needed)", async () => {
    viteGame();
    await init();
    const kept = read("ogs.manifest.json");
    out = [];
    expect(await init([])).toBe(0);
    expect(read("ogs.manifest.json")).toBe(kept);
    expect(out.join("\n")).toContain("keep   ogs.manifest.json");
  });

  it("an existing manifest that isn't valid: exit 1 with its issues", async () => {
    viteGame();
    put("ogs.manifest.json", JSON.stringify({ appId: "comet-catch" }));
    expect(await init([])).toBe(1);
    expect(err.join("\n")).toContain("ogs.manifest.json isn't valid");
    expect(err.join("\n")).toMatch(/name: /);
  });

  it("re-running keeps OGS.md and adds no dependency twice", async () => {
    viteGame();
    await init();
    put("OGS.md", "# my notes\n");
    const pkg = read("package.json");
    out = [];
    expect(await init([])).toBe(0);
    expect(read("OGS.md")).toBe("# my notes\n");
    expect(read("package.json")).toBe(pkg);
    expect(out.join("\n")).toContain("keep   OGS.md");
  });

  it("a dependency already pinned elsewhere is left as it is, and said", async () => {
    viteGame();
    const pkg = json("package.json");
    pkg.dependencies["@open-game-system/profile-kit"] = "file:vendor/old-profile-kit.tgz";
    put("package.json", JSON.stringify(pkg, null, 2));
    await init();
    expect(json("package.json").dependencies["@open-game-system/profile-kit"]).toBe(
      "file:vendor/old-profile-kit.tgz",
    );
    expect(out.join("\n")).toContain(
      "@open-game-system/profile-kit is already file:vendor/old-profile-kit.tgz: left as it is",
    );
  });

  it("no package.json: writes one with the kits", async () => {
    put("index.html", "<!doctype html><canvas></canvas>");
    expect(await init()).toBe(0);
    expect(json("package.json")).toMatchObject({
      name: "comet-catch",
      private: true,
      dependencies: { "@open-game-system/profile-kit": "file:vendor/profile-kit.tgz" },
    });
    expect(out.join("\n")).toContain("plain HTML game, npm (no lockfile)");
  });

  it("a kit that won't download: exit 1 and nothing is written", async () => {
    viteGame();
    const before = snapshot();
    routes[`${DOCS}/pkg/try-kit.tgz`] = () => new Response("gone", { status: 404 });
    expect(await init()).toBe(1);
    expect(err.join("\n")).toContain(
      `@open-game-system/try-kit: ${DOCS}/pkg/try-kit.tgz answered HTTP 404`,
    );
    expect(snapshot()).toEqual(before);
  });

  it("a kit URL that answers with a web page instead of a tarball: exit 1", async () => {
    viteGame();
    routes[`${DOCS}/pkg/profile-kit.tgz`] = () => new Response("<!doctype html>");
    expect(await init()).toBe(1);
    expect(err.join("\n")).toContain("isn't a .tgz");
  });

  it("the API's error from /dev/kits: exit 1", async () => {
    viteGame();
    routes[`${API}/api/v1/dev/kits`] = () =>
      Response.json({ error: { code: "docs_base_invalid", message: "bad" } }, { status: 500 });
    expect(await init()).toBe(1);
    expect(err.join("\n")).toContain("docs_base_invalid");
  });
});

describe("ogs init --codemod", () => {
  it("adds the TV hookup to the TV entry and the profile hookup to the phone entry", async () => {
    viteGame();
    expect(await init([...FLAGS, "--codemod"])).toBe(0);
    expect(read("src/tv.ts")).toMatch(
      /^import \* as THREE from "three";\nimport "\.\/tv\.css";\n\/\/ OGS[\s\S]*getOgsSessionSource\(\);[\s\S]*\n\nnew THREE\.Scene\(\);\n$/,
    );
    expect(read("src/main.ts")).toMatch(
      /^import \{ joinRoom \} from "\.\/net";\n\/\/ OGS[\s\S]*getOgsProfileSource\(\);\n\njoinRoom\(\);\n$/,
    );
    expect(out.join("\n")).toContain(
      '+ import { getOgsSessionSource, onOgsPause } from "@open-game-system/profile-kit";',
    );
    expect(read("OGS.md")).toContain("`src/tv.ts` (ogs init --codemod added the hookup)");
  });

  it("running it again changes nothing", async () => {
    viteGame();
    await init([...FLAGS, "--codemod"]);
    const tv = read("src/tv.ts");
    expect(await init(["--codemod"])).toBe(0);
    expect(read("src/tv.ts")).toBe(tv);
    expect(out.join("\n")).toContain("src/tv.ts already imports profile-kit");
  });

  it("two possible TV entries: touches neither and prints the snippet with the candidates", async () => {
    viteGame();
    put("src/tv/main.ts", "boot();\n");
    const tv = read("src/tv.ts");
    expect(await init([...FLAGS, "--codemod"])).toBe(0);
    expect(read("src/tv.ts")).toBe(tv);
    expect(read("src/tv/main.ts")).toBe("boot();\n");
    const text = out.join("\n");
    expect(text).toContain(
      "The TV page's launcher hookup: add this to one of src/tv.ts, src/tv/main.ts",
    );
    expect(text).toContain("getOgsSessionSource();");
  });

  it("no TV entry found: prints the snippet and where it goes", async () => {
    viteGame();
    put("tv.html", "<!doctype html>");
    rmSync(join(root, "src/tv.ts"));
    expect(await init([...FLAGS, "--codemod"])).toBe(0);
    expect(out.join("\n")).toContain(
      "The TV page's launcher hookup: add this at the top of the module that boots your TV page",
    );
  });

  it("Next.js: never patches, prints the snippets for client code", async () => {
    put("package.json", JSON.stringify({ dependencies: { next: "15.0.0" } }));
    put("src/tv.ts", "boot();\n");
    expect(await init([...FLAGS, "--codemod"])).toBe(0);
    expect(read("src/tv.ts")).toBe("boot();\n");
    expect(out.join("\n")).toContain('in client code ("use client")');
  });

  it("without --codemod no source file changes", async () => {
    viteGame();
    const tv = read("src/tv.ts");
    await init();
    expect(read("src/tv.ts")).toBe(tv);
  });
});

describe("ogs help", () => {
  it("lists ogs init", async () => {
    expect(await run(["--help"], io())).toBe(0);
    expect(out.join("\n")).toContain("ogs init");
  });
});
