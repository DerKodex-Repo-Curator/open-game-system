import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type OgsMdInput, renderOgsMd } from "./ogs-md";

/** OGS.md is the docs' quickstart for one repo: these keep it from drifting from the page. */
const QUICKSTART = readFileSync(
  join(__dirname, "../../../../apps/docs/content/quickstart.md"),
  "utf8",
);
const DOCS = "https://ogs-docs.pages.dev";

const input = (over: Partial<OgsMdInput> = {}): OgsMdInput => ({
  manifest: {
    appId: "comet-catch",
    name: "Comet Catch",
    startUrl: "https://comet.example/",
    tvUrl: "https://comet.example/tv.html",
  },
  docs: DOCS,
  llms: `${DOCS}/llms.txt`,
  quickstart: `${DOCS}/quickstart.md`,
  framework: "vite",
  install: "pnpm install",
  kits: ["@open-game-system/profile-kit", "@open-game-system/cast-kit-core"],
  tv: { status: "patched", file: "src/tv.ts" },
  phone: { status: "found", file: "src/main.ts" },
  ...over,
});

const textBlock = (md: string) => md.match(/```text\n([\s\S]*?)```/)?.[1];

describe("OGS.md", () => {
  it("has the quickstart's agent prompt, word for word", () => {
    expect(textBlock(QUICKSTART)).toBeTruthy();
    expect(textBlock(renderOgsMd(input()))).toBe(textBlock(QUICKSTART));
  });

  it("points the prompt at another docs base when the API says so", () => {
    const md = renderOgsMd(
      input({
        docs: "https://docs.test",
        llms: "https://docs.test/llms.txt",
        quickstart: "https://docs.test/quickstart.md",
      }),
    );
    expect(textBlock(md)).toContain("https://docs.test/quickstart.md");
    expect(md).not.toContain("ogs-docs.pages.dev");
  });

  it("has every step of the quickstart's checklist, in order, as a checkbox", () => {
    const steps = [...QUICKSTART.matchAll(/^### (\d+)\. (.+)$/gm)].map(([, n, t]) => `${n}. ${t}`);
    expect(steps.length).toBeGreaterThan(10);
    const md = renderOgsMd(input());
    const boxes = [...md.matchAll(/^- \[ \] \*\*(\d+\. .+?)\*\*/gm)].map(([, s]) => s);
    expect(boxes).toEqual(steps);
  });

  it("links llms.txt and the quickstart", () => {
    const md = renderOgsMd(input());
    expect(md).toContain(`${DOCS}/llms.txt`);
    expect(md).toContain(`${DOCS}/quickstart.md`);
  });

  it("is about this repo: its appId, install command, kits and entry files", () => {
    const md = renderOgsMd(input());
    expect(md).toContain("# OGS for Comet Catch");
    expect(md).toContain("`comet-catch`");
    expect(md).toContain("Run `pnpm install`");
    expect(md).toContain("`@open-game-system/cast-kit-core`");
    expect(md).toContain("`src/tv.ts` (ogs init --codemod added the hookup)");
    expect(md).toContain("`src/main.ts`");
    expect(md).toContain('appId: "comet-catch"');
    expect(md).toContain("Vite");
  });

  it("says where to look when it found no entry, or several", () => {
    const md = renderOgsMd(
      input({
        tv: { status: "none" },
        phone: { status: "ambiguous", files: ["src/phone.ts", "src/controller.ts"] },
      }),
    );
    expect(md).toContain("TV entry: not found");
    expect(md).toContain("Phone entry: one of `src/phone.ts`, `src/controller.ts`");
  });

  it("a room game (no tvUrl) keeps step 8; a static tvUrl says it can skip it", () => {
    expect(renderOgsMd(input())).toContain("Skip this: the manifest has a static `tvUrl`");
    const rooms = renderOgsMd(input({ manifest: { ...input().manifest, tvUrl: undefined } }));
    expect(rooms).not.toContain("Skip this: the manifest has a static `tvUrl`");
  });

  it("Next and TanStack Start: profile-kit runs in client code only", () => {
    expect(renderOgsMd(input({ framework: "next" }))).toContain('"use client"');
    expect(renderOgsMd(input({ framework: "tanstack-start" }))).toContain("client");
  });

  it("plain HTML: the kits need a bundler or an import map", () => {
    expect(renderOgsMd(input({ framework: "plain" }))).toContain("import map");
  });
});
