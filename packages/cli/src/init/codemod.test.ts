import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { files } from "../io";
import { findEntries, insertAfterImports, PHONE_SNIPPET, TV_SNIPPET } from "./codemod";

let root: string;
const fs = () =>
  files({
    env: {},
    stdout: () => {},
    stderr: () => {},
    readFile: (p) => readFileSync(p, "utf8"),
    fetch,
    cwd: () => root,
  });
const put = (path: string, content = "") => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const page = (src: string) =>
  `<!doctype html><html><body><div id="app"></div><script type="module" src="${src}"></script></body></html>`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ogs-codemod-"));
});

describe("finding the TV and phone entries", () => {
  it("a Vite multi-page game: tv.html's script is the TV entry, index.html's the phone's", () => {
    put("index.html", page("/src/main.ts"));
    put("tv.html", page("/src/tv.ts"));
    put("src/main.ts");
    put("src/tv.ts");
    expect(findEntries(fs(), root)).toEqual({ tv: ["src/tv.ts"], phone: ["src/main.ts"] });
  });

  it("a script path relative to a page in a folder", () => {
    put("tv/index.html", page("./main.tsx"));
    put("tv/main.tsx");
    put("phone/index.html", page("./main.tsx"));
    put("phone/main.tsx");
    expect(findEntries(fs(), root)).toEqual({ tv: ["tv/main.tsx"], phone: ["phone/main.tsx"] });
  });

  it("entry files by name when there are no pages for them", () => {
    put("src/tv/main.tsx");
    put("src/controller.tsx");
    expect(findEntries(fs(), root)).toEqual({
      tv: ["src/tv/main.tsx"],
      phone: ["src/controller.tsx"],
    });
  });

  it("one page for everything: index.html is not taken as the phone page", () => {
    put("index.html", page("/src/main.ts"));
    put("src/main.ts");
    expect(findEntries(fs(), root)).toEqual({ tv: [], phone: [] });
  });

  it("two TV candidates are both reported (the caller won't pick one)", () => {
    put("tv.html", page("/src/tv-app.ts"));
    put("src/tv-app.ts");
    put("src/tv.ts");
    expect(findEntries(fs(), root).tv.sort()).toEqual(["src/tv-app.ts", "src/tv.ts"]);
  });

  it("a script that isn't on disk (a CDN, a typo) is not a candidate", () => {
    put("tv.html", page("https://cdn.example/tv.js"));
    put("index.html", page("/src/missing.ts"));
    expect(findEntries(fs(), root)).toEqual({ tv: [], phone: [] });
  });
});

describe("adding the hookup", () => {
  it("goes after the last import, before the code", () => {
    const before = `import { a } from "a";\nimport {\n  b,\n  c,\n} from "./b";\n\nstart(a, b, c);\n`;
    const after = insertAfterImports(before, TV_SNIPPET);
    expect(after).toBe(
      `import { a } from "a";\nimport {\n  b,\n  c,\n} from "./b";\n${TV_SNIPPET}\n\nstart(a, b, c);\n`,
    );
  });

  it("goes after a directive and a leading comment when there are no imports", () => {
    const before = `"use strict";\n// the phone\nboot();\n`;
    expect(insertAfterImports(before, PHONE_SNIPPET)).toBe(
      `"use strict";\n// the phone\n${PHONE_SNIPPET}\nboot();\n`,
    );
  });

  it("side-effect imports count as imports", () => {
    const before = `import "./style.css";\nboot();\n`;
    expect(insertAfterImports(before, PHONE_SNIPPET)).toBe(
      `import "./style.css";\n${PHONE_SNIPPET}\nboot();\n`,
    );
  });

  it("a file that already imports profile-kit is left alone", () => {
    const before = `import { onOgsPause } from "@open-game-system/profile-kit";\nboot();\n`;
    expect(insertAfterImports(before, TV_SNIPPET)).toBeNull();
  });

  it("the snippets use profile-kit's TV and phone entry points", () => {
    expect(TV_SNIPPET).toContain(
      'import { getOgsSessionSource, onOgsPause } from "@open-game-system/profile-kit";',
    );
    expect(TV_SNIPPET).toContain("getOgsSessionSource();");
    expect(PHONE_SNIPPET).toContain(
      'import { getOgsProfileSource } from "@open-game-system/profile-kit";',
    );
  });
});
