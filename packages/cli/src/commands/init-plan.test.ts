import { describe, expect, it } from "vitest";
import { type Io, run } from "../cli";
import { PHONE_SNIPPET, TV_SNIPPET } from "../init/codemod";

/**
 * Exactly what `ogs init` prints and writes for each kind of repo (init.test.ts walks the flows on
 * disk); the repo here is in memory at /r.
 */
const API = "https://api.test";
const DOCS = "https://docs.test";
const KIT = {
  name: "@open-game-system/profile-kit",
  file: "profile-kit.tgz",
  url: `${DOCS}/pkg/profile-kit.tgz`,
};
const TGZ = new Uint8Array([0x1f, 0x8b, 8]);
const FLAGS = ["--app-id", "comet", "--name", "Comet", "--start-url", "https://comet.example/"];
const page = (src: string) => `<script type="module" src="${src}"></script>`;

function setup(content: Record<string, string>, over: Partial<Io> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const fetched: string[] = [];
  const at = (p: string) => p.replace(/^\/r\//, "");
  const io: Io = {
    env: { OGS_API: API },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: (p) => {
      const v = content[at(p)];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    exists: (p) => at(p) in content,
    writeFile: (p, d) => {
      written[at(p)] = typeof d === "string" ? d : `bytes:${d.length}`;
    },
    fetch: async (input) => {
      const url = String(input);
      fetched.push(url);
      if (url === `${API}/api/v1/dev/kits`)
        return Response.json({
          docs: DOCS,
          llms: `${DOCS}/llms.txt`,
          quickstart: `${DOCS}/quickstart.md`,
          kits: [KIT],
        });
      if (url === KIT.url) return new Response(TGZ);
      return new Response("not found", { status: 404 });
    },
    cwd: () => "/r",
    isTTY: false,
    ...over,
  };
  const init = (args: string[]) => run(["init", ...args], io);
  return { out, err, written, fetched, init };
}

const vite = (extra: Record<string, string> = {}) => ({
  "package.json": `${JSON.stringify({ name: "comet", devDependencies: { vite: "7" } }, null, 2)}\n`,
  "pnpm-lock.yaml": "",
  "tv.html": page("/src/tv.ts"),
  "phone.html": page("/src/phone.ts"),
  "src/tv.ts": 'import "./tv.css";\nrun();',
  "src/phone.ts": "join();",
  ...extra,
});

const plus = (snippet: string) =>
  snippet
    .split("\n")
    .map((l) => `+ ${l}`)
    .join("\n");

describe("ogs init's plan", () => {
  it("Vite with --codemod: patches both entries and prints the diffs", async () => {
    const s = setup(vite());
    expect(await s.init([...FLAGS, "--codemod"])).toBe(0);
    expect(s.out).toEqual([
      "ogs init: Comet (comet)",
      "Vite game, pnpm (pnpm-lock.yaml)",
      "",
      "  write  ogs.manifest.json",
      `  write  vendor/profile-kit.tgz  (${KIT.url})`,
      "  edit   package.json  (+ @open-game-system/profile-kit)",
      "  edit   src/tv.ts  (the TV page's launcher hookup)",
      "  edit   src/phone.ts  (the phone page's profile hookup)",
      "  write  OGS.md",
      `\nsrc/tv.ts:\n${plus(TV_SNIPPET)}`,
      `\nsrc/phone.ts:\n${plus(PHONE_SNIPPET)}`,
      "",
      `Done. Next: pnpm install, then work down OGS.md (its prompt is for your coding agent; ${DOCS}/llms.txt).`,
    ]);
    expect(s.written["src/tv.ts"]).toBe(`import "./tv.css";\n${TV_SNIPPET}\nrun();`);
    expect(s.written["src/phone.ts"]).toBe(`${PHONE_SNIPPET}\njoin();`);
    expect(s.written["vendor/profile-kit.tgz"]).toBe("bytes:3");
    expect(Object.keys(s.written).sort()).toEqual([
      "OGS.md",
      "ogs.manifest.json",
      "package.json",
      "src/phone.ts",
      "src/tv.ts",
      "vendor/profile-kit.tgz",
    ]);
    expect(s.written["OGS.md"]).toContain(
      "- TV entry: `src/tv.ts` (ogs init --codemod added the hookup)",
    );
  });

  it("without --codemod: entries found, nothing patched, no snippets", async () => {
    const s = setup(vite());
    await s.init(FLAGS);
    expect(s.out.filter((l) => l.startsWith("  edit") || l.startsWith("\n"))).toEqual([
      "  edit   package.json  (+ @open-game-system/profile-kit)",
    ]);
    expect(s.written["src/tv.ts"]).toBeUndefined();
    expect(s.written["OGS.md"]).toContain("- TV entry: `src/tv.ts`\n");
  });

  it("entries that already import profile-kit: noted with --codemod, left alone", async () => {
    const hooked = 'import { x } from "@open-game-system/profile-kit";\n';
    const s = setup(vite({ "src/tv.ts": hooked, "src/phone.ts": hooked }));
    await s.init([...FLAGS, "--codemod"]);
    expect(s.out.filter((l) => l.startsWith("  note") || l.startsWith("\n"))).toEqual([
      "  note   src/tv.ts already imports profile-kit",
      "  note   src/phone.ts already imports profile-kit",
    ]);
    expect(s.written["OGS.md"]).toContain("- TV entry: `src/tv.ts` (already imports profile-kit)");
    expect(s.written["src/tv.ts"]).toBeUndefined();
    const t = setup(vite({ "src/tv.ts": hooked }));
    await t.init(FLAGS);
    expect(t.out.some((l) => l.includes("note"))).toBe(false);
  });

  it("no entries found: where each snippet goes, with --codemod only", async () => {
    const s = setup({ "package.json": '{"devDependencies":{"vite":"7"}}' });
    await s.init([...FLAGS, "--codemod"]);
    expect(s.out.filter((l) => l.startsWith("\n"))).toEqual([
      `\nThe TV page's launcher hookup: add this at the top of the module that boots your TV page:\n${TV_SNIPPET}`,
      `\nThe phone page's profile hookup: add this at the top of the module that boots your phone page:\n${PHONE_SNIPPET}`,
    ]);
    expect(s.written["OGS.md"]).toContain(
      "- TV entry: not found (the module that boots your TV page)",
    );
  });

  it("several candidates: one of them, by name", async () => {
    const s = setup(vite({ "src/tv/main.ts": "", "src/controller.ts": "" }));
    await s.init([...FLAGS, "--codemod"]);
    expect(s.out.filter((l) => l.startsWith("\n"))).toEqual([
      `\nThe TV page's launcher hookup: add this to one of src/tv.ts, src/tv/main.ts:\n${TV_SNIPPET}`,
      `\nThe phone page's profile hookup: add this to one of src/phone.ts, src/controller.ts:\n${PHONE_SNIPPET}`,
    ]);
    expect(s.written["OGS.md"]).toContain("- TV entry: one of `src/tv.ts`, `src/tv/main.ts`");
  });

  it.each([
    [
      "next",
      '{"dependencies":{"next":"15"}}',
      'add this in client code ("use client") of your TV page',
    ],
    [
      "tanstack-start",
      '{"dependencies":{"@tanstack/react-start":"1"}}',
      "add this in client-only code (inside useEffect) of your TV page",
    ],
    [
      "plain",
      "{}",
      "add this to your TV page's module script once a bundler or an import map can load the kits (OGS.md)",
    ],
  ])("%s: the one entry isn't patched; says where it goes", async (_, pkg, where) => {
    const s = setup({ "package.json": pkg, "src/tv.ts": "run();" });
    await s.init([...FLAGS, "--codemod"]);
    expect(s.out).toContain(`\nThe TV page's launcher hookup: ${where}:\n${TV_SNIPPET}`);
    expect(s.written["src/tv.ts"]).toBeUndefined();
    expect(s.written["OGS.md"]).toContain("- TV entry: `src/tv.ts`\n");
  });

  it("packageManager in package.json, and no lockfile", async () => {
    const s = setup({ "package.json": '{"packageManager":"yarn@4"}' });
    await s.init(FLAGS);
    expect(s.out[1]).toBe("plain HTML game, yarn (packageManager in package.json)");
    const t = setup({});
    await t.init(FLAGS);
    expect(t.out[1]).toBe("plain HTML game, npm (no lockfile)");
    expect(t.out).toContain("  write  package.json  (new, with the kits)");
  });

  it("the kits already there: package.json kept", async () => {
    const s = setup({
      "package.json": JSON.stringify({
        dependencies: { [KIT.name]: "file:vendor/profile-kit.tgz" },
      }),
    });
    await s.init(FLAGS);
    expect(s.out).toContain("  keep   package.json  (has the kits)");
    expect(s.written["package.json"]).toBeUndefined();
  });

  it("an existing manifest and OGS.md are kept", async () => {
    const manifest = {
      appId: "comet",
      name: "Comet",
      shape: "couch",
      tv: "optional",
      startUrl: "https://comet.example/",
      art: { tile: "/t.jpg" },
    };
    const s = setup({ "ogs.manifest.json": JSON.stringify(manifest), "OGS.md": "mine" });
    expect(await s.init([])).toBe(0);
    expect(s.out).toContain("  keep   ogs.manifest.json  (yours: flags don't change it)");
    expect(s.out).toContain("  keep   OGS.md  (yours)");
    expect(s.written["OGS.md"]).toBeUndefined();
    expect(s.written["ogs.manifest.json"]).toBeUndefined();
  });

  it("an existing manifest that isn't JSON, or isn't valid", async () => {
    const s = setup({ "ogs.manifest.json": "{" });
    expect(await s.init([])).toBe(1);
    expect(s.err[0]).toMatch(
      /^ogs\.manifest\.json isn't valid \(fix it, or delete it and run ogs init again\):\n {2}\(root\): .+$/,
    );
    const t = setup({ "ogs.manifest.json": '{"appId":"comet"}' });
    expect(await t.init([])).toBe(1);
    expect(t.err[0]).toMatch(/:\n {2}name: [^\n]+\n {2}/);
    expect(t.fetched).toEqual([]);
  });

  it("--dry: the plan, then nothing written and no kit downloaded", async () => {
    const s = setup(vite());
    expect(await s.init([...FLAGS, "--dry"])).toBe(0);
    expect(s.out.slice(-2)).toEqual(["", "Dry run: nothing changed."]);
    expect(s.written).toEqual({});
    expect(s.fetched).toEqual([`${API}/api/v1/dev/kits`]);
  });

  it("a flag it doesn't know: the parser's message and the usage (exit 2)", async () => {
    const s = setup({});
    expect(await s.init(["--nope"])).toBe(2);
    expect(s.err).toHaveLength(1);
    const [message, usage] = (s.err[0] ?? "").split("\n\n");
    expect(message).toMatch(/^Unknown option '--nope'/);
    expect(usage).toBe(
      "Usage: ogs init [--app-id <id>] [--name <name>] [--start-url <url>] [--tv-url <url>]\n         [--shape couch|live|async] [--tv none|optional|required] [--codemod] [--dry]",
    );
  });

  it("missing flags, no terminal: says which and why it can't ask", async () => {
    const s = setup({});
    expect(await s.init(["--app-id", "  ", "--name", "Comet"])).toBe(2);
    expect(s.err).toEqual([
      "ogs init: missing --app-id, --start-url (no terminal to ask in)\n\nUsage: ogs init [--app-id <id>] [--name <name>] [--start-url <url>] [--tv-url <url>]\n         [--shape couch|live|async] [--tv none|optional|required] [--codemod] [--dry]",
    ]);
  });

  it("at a terminal: trims answers; a blank answer is still missing", async () => {
    const asked: string[] = [];
    const answers: Record<string, string> = {
      "appId (lowercase letters, digits and hyphens, e.g. space-bakery): ": "  comet  ",
      "Game name: ": "   ",
      "Start URL (the phone page, https://…): ": "https://comet.example/",
      "TV page URL (blank: none, the phone page declares it per room): ": "",
    };
    const s = setup(
      {},
      {
        isTTY: true,
        prompt: async (q) => {
          asked.push(q);
          return answers[q] ?? "";
        },
      },
    );
    expect(await s.init([])).toBe(2);
    expect(asked).toEqual(Object.keys(answers));
    expect(s.err).toEqual([
      "ogs init: missing --name\n\nUsage: ogs init [--app-id <id>] [--name <name>] [--start-url <url>] [--tv-url <url>]\n         [--shape couch|live|async] [--tv none|optional|required] [--codemod] [--dry]",
    ]);
  });

  it("at a terminal with every flag given, nothing is asked; with --tv-url, the TV isn't asked", async () => {
    const asked: string[] = [];
    const prompt = async (q: string) => {
      asked.push(q);
      return "Comet";
    };
    const s = setup({}, { isTTY: true, prompt });
    await s.init(FLAGS);
    expect(asked).toEqual([]);
    const t = setup({}, { isTTY: true, prompt });
    expect(
      await t.init([
        "--app-id",
        "comet",
        "--start-url",
        "https://comet.example/",
        "--tv-url",
        " https://comet.example/tv ",
      ]),
    ).toBe(0);
    expect(asked).toEqual(["Game name: "]);
    expect(JSON.parse(t.written["ogs.manifest.json"] ?? "{}")).toMatchObject({
      name: "Comet",
      tvUrl: "https://comet.example/tv",
      tv: "required",
    });
  });

  it("a terminal without a way to ask is no terminal", async () => {
    const s = setup({}, { isTTY: true });
    expect(await s.init(["--name", "Comet"])).toBe(2);
    expect(s.err[0]).toMatch(/^ogs init: missing --app-id, --start-url\n\nUsage: /);
  });

  it("flags the schema refuses: exit 2 with its issues", async () => {
    const s = setup({});
    expect(await s.init([...FLAGS, "--tv", "sometimes"])).toBe(2);
    expect(s.err[0]).toMatch(/^ogs\.manifest\.json wouldn't be valid:\n {2}tv: /);
    expect(s.fetched).toEqual([]);
  });

  it("--shape and --tv, trimmed", async () => {
    const s = setup({});
    await s.init([...FLAGS, "--shape", " live ", "--tv", " none "]);
    expect(JSON.parse(s.written["ogs.manifest.json"] ?? "{}")).toMatchObject({
      shape: "live",
      tv: "none",
    });
  });

  it("a blank --shape or --tv is no flag: the defaults", async () => {
    const s = setup({});
    expect(await s.init([...FLAGS, "--shape", "  ", "--tv", " "])).toBe(0);
    expect(JSON.parse(s.written["ogs.manifest.json"] ?? "{}")).toMatchObject({
      shape: "couch",
      tv: "optional",
    });
  });

  it("OGS.md lists the kits it vendored", async () => {
    const s = setup({});
    await s.init(FLAGS);
    expect(s.written["OGS.md"]).toContain("- Kits in `vendor/`: `@open-game-system/profile-kit`\n");
  });
});
