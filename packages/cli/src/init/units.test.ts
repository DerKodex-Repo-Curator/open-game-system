import { describe, expect, it } from "vitest";
import { CliError, type Files, type Io } from "../io";
import { findEntries, insertAfterImports } from "./codemod";
import { detectFramework, detectPackageManager, FRAMEWORK_NAMES, readPackageJson } from "./detect";
import { downloadKit, fetchKits, type Kit, KitsSchema } from "./kits";
import { checkManifest } from "./manifest";
import { type Entry, type OgsMdInput, renderOgsMd } from "./ogs-md";
import { addDependencies } from "./package-json";

/** What ogs init reads and writes, piece by piece, on an in-memory repo at /r. */
function repo(content: Record<string, string>): Files {
  const at = (p: string) => p.replace(/^\/r\//, "");
  return {
    cwd: "/r",
    read: (p) => {
      const v = content[at(p)];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    write: (p, d) => {
      content[at(p)] = String(d);
    },
    exists: (p) => at(p) in content,
    list: () => [],
  };
}
const module = (src: string, attrs = 'type="module"') => `<script ${attrs} src="${src}"></script>`;

describe("finding entries", () => {
  it.each([
    "src/tv.ts",
    "src/tv.tsx",
    "src/tv.js",
    "src/tv.jsx",
    "src/tv.mjs",
    "src/tv/main.ts",
    "src/tv/index.ts",
    "src/tv-main.ts",
    "src/main-tv.ts",
  ])("%s is a TV entry by name", (file) => {
    expect(findEntries(repo({ [file]: "" }), "/r").tv).toEqual([file]);
  });

  it.each([
    "src/phone.ts",
    "src/phone/main.ts",
    "src/phone/index.ts",
    "src/controller.ts",
    "src/controller/main.ts",
    "src/controller/index.mjs",
  ])("%s is a phone entry by name", (file) => {
    expect(findEntries(repo({ [file]: "" }), "/r").phone).toEqual([file]);
  });

  it("pages' module scripts: absolute, relative, with any spacing and quotes", () => {
    const fs = repo({
      "tv.html": `${module("/src/a.ts", "type = 'module'")}<script src="/src/b.ts" type =module></script>`,
      "phone/index.html": `<script\n type="module"\n src = 'main.ts'></script>`,
      "src/a.ts": "",
      "src/b.ts": "",
      "phone/main.ts": "",
    });
    expect(findEntries(fs, "/r")).toEqual({ tv: ["src/a.ts"], phone: ["phone/main.ts"] });
  });

  it("skips classic scripts, scripts without src, and other sites' scripts", () => {
    const fs = repo({
      "tv.html": [
        '<script src="/src/classic.ts"></script>',
        '<script type="module">inline()</script>',
        module("https://cdn.test/x.ts"),
        module("//cdn.test/y.ts"),
        module("HTTP://cdn.test/z.ts"),
        module("/src/tv-entry.ts"),
      ].join(""),
      "src/classic.ts": "",
      "src/tv-entry.ts": "",
      // Where each other-site src would land if it were taken as a path: it isn't.
      "https:/cdn.test/x.ts": "",
      "cdn.test/y.ts": "",
      "HTTP:/cdn.test/z.ts": "",
    });
    expect(findEntries(fs, "/r").tv).toEqual(["src/tv-entry.ts"]);
  });

  it("a local src with a double slash in it is still local", () => {
    const fs = repo({ "tv.html": module("/src//tv-entry.ts"), "src/tv-entry.ts": "" });
    expect(findEntries(fs, "/r").tv).toEqual(["src/tv-entry.ts"]);
  });

  it("an absolute src in a page in a folder is from the repo's root", () => {
    const fs = repo({
      "phone/index.html": module("/src/p.ts"),
      "src/p.ts": "",
      "phone/src/p.ts": "",
    });
    expect(findEntries(fs, "/r").phone).toEqual(["src/p.ts"]);
  });

  it("a script that isn't there isn't an entry", () => {
    expect(findEntries(repo({ "tv.html": module("/src/gone.ts") }), "/r").tv).toEqual([]);
  });

  it("a src that's only a slash-free name next to the page", () => {
    const fs = repo({ "tv/index.html": module("app.js"), "tv/app.js": "" });
    expect(findEntries(fs, "/r").tv).toEqual(["tv/app.js"]);
  });

  it("the same file named twice counts once", () => {
    const fs = repo({ "tv.html": module("/src/tv.ts") + module("./src/tv.ts"), "src/tv.ts": "" });
    expect(findEntries(fs, "/r").tv).toEqual(["src/tv.ts"]);
  });

  it("index.html is the phone page when there's a TV entry and no phone entry, minus the TV's scripts", () => {
    const fs = repo({
      "index.html": module("/src/main.ts") + module("/src/tv.ts"),
      "src/main.ts": "",
      "src/tv.ts": "",
    });
    expect(findEntries(fs, "/r")).toEqual({ tv: ["src/tv.ts"], phone: ["src/main.ts"] });
  });

  it("with a phone entry already, index.html isn't looked at", () => {
    const fs = repo({
      "index.html": module("/src/main.ts"),
      "src/main.ts": "",
      "src/tv.ts": "",
      "src/phone.ts": "",
    });
    expect(findEntries(fs, "/r").phone).toEqual(["src/phone.ts"]);
  });

  it("without a TV entry, index.html isn't the phone page", () => {
    const fs = repo({ "index.html": module("/src/main.ts"), "src/main.ts": "" });
    expect(findEntries(fs, "/r")).toEqual({ tv: [], phone: [] });
  });
});

describe("inserting the hookup", () => {
  const S = "SNIPPET";
  it.each([
    ["no imports at all", "run();", "SNIPPET\nrun();"],
    ["an empty file", "", "SNIPPET\n"],
    ["blank lines before the code", "\n\nrun();", "SNIPPET\n\n\nrun();"],
    [
      "blank lines between imports",
      'import a from "a";\n\nimport b from "b";\nrun();',
      'import a from "a";\n\nimport b from "b";\nSNIPPET\nrun();',
    ],
    [
      "an import without a semicolon, then trailing space",
      "import a from 'a'   \nrun();",
      "import a from 'a'   \nSNIPPET\nrun();",
    ],
    [
      "a side-effect import with a semicolon",
      "import './x.css';\nrun();",
      "import './x.css';\nSNIPPET\nrun();",
    ],
    [
      "imports of every shape",
      'import{a}from"a"\nimport*as b from"b"\nimport"c"\nrun();',
      'import{a}from"a"\nimport*as b from"b"\nimport"c"\nSNIPPET\nrun();',
    ],
    [
      "a multi-line import",
      'import {\n  a,\n  b,\n} from "a";\nrun();',
      'import {\n  a,\n  b,\n} from "a";\nSNIPPET\nrun();',
    ],
    [
      "a multi-line import ending in a side-effect form",
      "import {\n  a\n}\nfrom 'a'\nrun();",
      "import {\n  a\n}\nfrom 'a'\nSNIPPET\nrun();",
    ],
    [
      "a shebang, a block comment, a directive",
      '#!/usr/bin/env node\n/* c\n * d\n */\n"use client"\nrun();',
      '#!/usr/bin/env node\n/* c\n * d\n */\n"use client"\nSNIPPET\nrun();',
    ],
    ["a directive with a semicolon", "'use strict';\nrun();", "'use strict';\nSNIPPET\nrun();"],
    [
      "a word starting with import isn't one",
      "importantThing();\nimport a from 'a';",
      "SNIPPET\nimportantThing();\nimport a from 'a';",
    ],
    [
      "a line ending with from in a string isn't an import",
      "const x = 'import from \"a\"';\nrun();",
      "SNIPPET\nconst x = 'import from \"a\"';\nrun();",
    ],
    [
      "a directive followed by code isn't a directive",
      '"use client"; run();\nmore();',
      'SNIPPET\n"use client"; run();\nmore();',
    ],
    [
      "an import followed by code on the same line",
      'import a from "a"; run();\nmore();',
      'SNIPPET\nimport a from "a"; run();\nmore();',
    ],
    ["indented imports", '  import a from "a";\nrun();', '  import a from "a";\nSNIPPET\nrun();'],
    [
      "a comment after the imports, then code",
      'import a from "a";\n// c\nrun();',
      'import a from "a";\n// c\nSNIPPET\nrun();',
    ],
    [
      "a comment inside a multi-line import that mentions an import",
      'import {\n  a, // like import "b"\n} from "a";\nrun();',
      'import {\n  a, // like import "b"\n} from "a";\nSNIPPET\nrun();',
    ],
    [
      "spaces after an import's semicolon",
      'import a from "a";  \nrun();',
      'import a from "a";  \nSNIPPET\nrun();',
    ],
    [
      "code that mentions an import is code",
      'log("import x");\nimport a from "a";\nrun();',
      'SNIPPET\nlog("import x");\nimport a from "a";\nrun();',
    ],
    [
      "code with a comment after it is code",
      "run(); // go\nmore();",
      "SNIPPET\nrun(); // go\nmore();",
    ],
    [
      "code that ends with a directive-like string is code",
      'const a = "use client";\nrun();',
      'SNIPPET\nconst a = "use client";\nrun();',
    ],
    [
      "a blank line inside a multi-line import",
      'import {\n\n  a,\n} from "a";\nrun();',
      'import {\n\n  a,\n} from "a";\nSNIPPET\nrun();',
    ],
  ])("%s", (_, source, expected) => {
    expect(insertAfterImports(source, S)).toBe(expected);
  });

  it("an import between imports with spaces before its quotes", () => {
    expect(insertAfterImports('import a from  "a" ;\nx();', S)).toBe(
      'import a from  "a" ;\nSNIPPET\nx();',
    );
    expect(insertAfterImports("import  'a';\nx();", S)).toBe("import  'a';\nSNIPPET\nx();");
  });
});

describe("detecting the repo", () => {
  it("names each framework", () => {
    expect(FRAMEWORK_NAMES).toEqual({
      vite: "Vite",
      plain: "plain HTML",
      next: "Next.js",
      "tanstack-start": "TanStack Start",
    });
  });

  it.each([
    "@tanstack/react-start",
    "@tanstack/solid-start",
    "@tanstack/start",
  ])("%s is TanStack Start", (dep) => {
    const fs = repo({
      "package.json": JSON.stringify({ dependencies: { [dep]: "1", next: "1" } }),
    });
    expect(detectFramework(fs, "/r")).toBe("tanstack-start");
  });

  it.each([
    "ts",
    "mts",
    "js",
    "mjs",
    "cjs",
  ])("vite.config.%s is Vite; next.config.%s is Next", (ext) => {
    expect(detectFramework(repo({ [`vite.config.${ext}`]: "" }), "/r")).toBe("vite");
    expect(detectFramework(repo({ [`next.config.${ext}`]: "" }), "/r")).toBe("next");
  });

  it("dependencies count as much as devDependencies", () => {
    const fs = repo({ "package.json": JSON.stringify({ dependencies: { vite: "1" } }) });
    expect(detectFramework(fs, "/r")).toBe("vite");
  });

  it("package.json: none, not JSON, the wrong shape", () => {
    expect(readPackageJson(repo({}), "/r")).toBeNull();
    expect(readPackageJson(repo({ "package.json": "{" }), "/r")).toBeNull();
    expect(readPackageJson(repo({ "package.json": '{"dependencies":[1]}' }), "/r")).toBeNull();
    expect(readPackageJson(repo({ "package.json": '{"x":1}' }), "/r")).toEqual({ x: 1 });
  });

  it.each(["pnpm", "npm", "yarn", "bun"])("packageManager %s@x", (pm) => {
    const fs = repo({ "package.json": JSON.stringify({ packageManager: `${pm}@9.0.0` }) });
    expect(detectPackageManager(fs, "/r")).toEqual({ pm, from: "packageManager" });
  });

  it("an unknown packageManager falls back to the lockfile", () => {
    const fs = repo({
      "package.json": JSON.stringify({ packageManager: "deno@2" }),
      "yarn.lock": "",
    });
    expect(detectPackageManager(fs, "/r")).toEqual({ pm: "yarn", from: "yarn.lock" });
  });

  it.each([
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ])("%s is %s", (lock, pm) => {
    expect(detectPackageManager(repo({ [lock]: "" }), "/r")).toEqual({ pm, from: lock });
  });
});

describe("the kits", () => {
  const io = (answer: () => Response, seen: string[] = []): Io => ({
    env: { OGS_API: "https://api.test" },
    stdout: () => {},
    stderr: () => {},
    readFile: () => "",
    fetch: async (input) => {
      seen.push(String(input));
      return answer();
    },
  });
  const kit: Kit = {
    name: "@open-game-system/profile-kit",
    file: "profile-kit.tgz",
    url: "https://docs.test/profile-kit.tgz",
  };
  const kits = (over: Partial<Kit>) => ({
    docs: "d",
    llms: "l",
    quickstart: "q",
    kits: [{ ...kit, ...over }],
  });

  it("only kits OGS publishes, as .tgz files, over http(s)", () => {
    expect(KitsSchema.safeParse(kits({})).success).toBe(true);
    expect(KitsSchema.safeParse(kits({ url: "http://docs.test/k.tgz" })).success).toBe(true);
    for (const bad of [
      { name: "x@open-game-system/k" },
      { name: "@open-game-system/k/../x" },
      { file: "../k.tgz" },
      { file: "k.tgz.sh" },
      { url: "ftp://docs.test/k.tgz" },
      { url: "xhttps://docs.test/k.tgz" },
      { url: "httpsx://docs.test/k.tgz" },
    ])
      expect(KitsSchema.safeParse(kits(bad)).success, JSON.stringify(bad)).toBe(false);
  });

  it("fetchKits: GET /api/v1/dev/kits, or the API's error, or the status", async () => {
    const seen: string[] = [];
    expect(await fetchKits(io(() => Response.json(kits({})), seen))).toEqual(kits({}));
    expect(seen).toEqual(["https://api.test/api/v1/dev/kits"]);
    await expect(
      fetchKits(io(() => Response.json({ error: { code: "c", message: "m" } }, { status: 500 }))),
    ).rejects.toThrow(new CliError("c: m"));
    await expect(
      fetchKits(io(() => Response.json({ error: { code: "c" } }, { status: 500 }))),
    ).rejects.toThrow(new CliError("c:"));
    await expect(fetchKits(io(() => new Response("<html>", { status: 502 })))).rejects.toThrow(
      new CliError("GET /api/v1/dev/kits answered HTTP 502"),
    );
  });

  it("downloadKit: gzip only", async () => {
    const gz = new Uint8Array([0x1f, 0x8b, 8]);
    expect(
      await downloadKit(
        io(() => new Response(gz)),
        kit,
      ),
    ).toEqual(gz);
    const notGzip = `${kit.name}: ${kit.url} isn't a .tgz (not gzip)`;
    for (const bytes of [[0x1f, 0x00], [0x00, 0x8b], []])
      await expect(
        downloadKit(
          io(() => new Response(new Uint8Array(bytes))),
          kit,
        ),
      ).rejects.toThrow(new CliError(notGzip));
    await expect(
      downloadKit(
        io(() => new Response("x", { status: 404 })),
        kit,
      ),
    ).rejects.toThrow(new CliError(`${kit.name}: ${kit.url} answered HTTP 404`));
  });
});

describe("package.json", () => {
  const deps = { "@open-game-system/profile-kit": "file:vendor/profile-kit.tgz" };

  it("a new one: the name, private, the kits", () => {
    expect(addDependencies(null, deps, "comet")).toEqual({
      text: `${JSON.stringify({ name: "comet", private: true, dependencies: deps }, null, 2)}\n`,
      added: ["@open-game-system/profile-kit"],
      kept: [],
    });
  });

  it("keeps a tab indent, and the file as it is when nothing's added", () => {
    const text = `{\n\t"name": "x",\n\t"dependencies": {\n\t\t"@open-game-system/profile-kit": "file:vendor/profile-kit.tgz"\n\t}\n}`;
    expect(addDependencies(text, deps, "x")).toEqual({ text, added: [], kept: [] });
    const tabbed = `{\n\t"name": "x"\n}`;
    expect(addDependencies(tabbed, deps, "x").text).toBe(
      `${JSON.stringify({ name: "x", dependencies: deps }, null, "\t")}\n`,
    );
  });

  it("four spaces; one line (no indent found) gets two", () => {
    expect(addDependencies('{\n    "name": "x"\n}', deps, "x").text).toBe(
      `${JSON.stringify({ name: "x", dependencies: deps }, null, 4)}\n`,
    );
    expect(addDependencies('{"name":"x"}', deps, "x").text).toBe(
      `${JSON.stringify({ name: "x", dependencies: deps }, null, 2)}\n`,
    );
    expect(addDependencies('{"a":\n  1,"name":"x"}', deps, "x").text).toBe(
      `${JSON.stringify({ a: 1, name: "x", dependencies: deps }, null, 2)}\n`,
    );
  });

  it("a kit under another spec is kept and reported; the same spec isn't", () => {
    const text = JSON.stringify({ dependencies: { "@open-game-system/profile-kit": "^1.0.0" } });
    expect(addDependencies(text, deps, "x")).toEqual({
      text,
      added: [],
      kept: [{ name: "@open-game-system/profile-kit", spec: "^1.0.0" }],
    });
  });

  it("a new one with nothing to add is still written", () => {
    expect(addDependencies(null, {}, "comet")).toEqual({
      text: `${JSON.stringify({ name: "comet", private: true, dependencies: {} }, null, 2)}\n`,
      added: [],
      kept: [],
    });
  });

  it("a one-line file with spaces in it still gets two-space indent", () => {
    expect(addDependencies('{"name": "x"}', deps, "x").text).toBe(
      `${JSON.stringify({ name: "x", dependencies: deps }, null, 2)}\n`,
    );
  });

  it("not JSON, or dependencies that aren't an object", () => {
    for (const text of ["{", '{"dependencies":[]}', '{"dependencies":{"a":1}}'])
      expect(() => addDependencies(text, deps, "x")).toThrow(
        new CliError("package.json isn't valid JSON with a dependencies object"),
      );
  });
});

describe("the manifest's issues", () => {
  it("are named by their path, joined with dots", () => {
    const checked = checkManifest({ appId: "a", art: { tile: 1 } });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues.map((i) => i.path)).toContain("art.tile");
  });
});

describe("OGS.md", () => {
  const input = (over: Partial<OgsMdInput> = {}): OgsMdInput => ({
    manifest: { appId: "comet-catch", name: "Comet Catch", startUrl: "https://comet.example/" },
    docs: "https://docs.test",
    llms: "https://docs.test/llms.txt",
    quickstart: "https://docs.test/quickstart.md",
    framework: "vite",
    install: "pnpm install",
    kits: ["@open-game-system/profile-kit", "@open-game-system/cast-kit-core"],
    tv: { status: "none" },
    phone: { status: "none" },
    ...over,
  });

  it.each<[Entry, string, string]>([
    [
      { status: "patched", file: "src/tv.ts" },
      "`src/tv.ts` (ogs init --codemod added the hookup)",
      " In `src/tv.ts`.",
    ],
    [
      { status: "hooked", file: "src/tv.ts" },
      "`src/tv.ts` (already imports profile-kit)",
      " In `src/tv.ts`.",
    ],
    [{ status: "found", file: "src/tv.ts" }, "`src/tv.ts`", " In `src/tv.ts`."],
    [{ status: "ambiguous", files: ["a.ts", "b.ts"] }, "one of `a.ts`, `b.ts`", ""],
    [{ status: "none" }, "not found (the module that boots your TV page)", ""],
  ])("a TV entry %j", (tv, where, inFile) => {
    const md = renderOgsMd(input({ tv }));
    expect(md).toContain(`- TV entry: ${where}\n`);
    expect(md).toContain(`resumes only what played.${inFile}\n`);
    expect(md).toContain("- Phone entry: not found (the module that boots your phone page)\n");
  });

  it("a phone entry in a file", () => {
    const md = renderOgsMd(input({ phone: { status: "hooked", file: "src/p.ts" } }));
    expect(md).toContain("- Phone entry: `src/p.ts` (already imports profile-kit)\n");
    expect(md).toContain("the form stays. In `src/p.ts`.\n");
  });

  it("is exactly this for a room game on Vite", () => {
    expect(renderOgsMd(input())).toMatchSnapshot();
  });

  it("is exactly this for a static TV page on Next", () => {
    expect(
      renderOgsMd(
        input({
          framework: "next",
          manifest: {
            appId: "comet-catch",
            name: "Comet Catch",
            startUrl: "https://comet.example/",
            tvUrl: "https://comet.example/tv",
          },
        }),
      ),
    ).toMatchSnapshot();
  });
});
