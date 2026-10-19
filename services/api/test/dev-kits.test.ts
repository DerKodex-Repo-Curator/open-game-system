import { describe, expect, it } from "vitest";
import app from "../src/index";

/**
 * GET /api/v1/dev/kits (docs/design-docs/ogs-cli.md, "ogs init"): public, where the docs and the kit
 * tarballs are. `ogs init` downloads every kit it lists into the game's vendor/.
 */
const kits = (env: Record<string, string> = {}) => app.request("/api/v1/dev/kits", {}, env);

describe("GET /api/v1/dev/kits", { timeout: 20_000 }, () => {
  it("lists the docs, llms.txt, the quickstart and the four kits under <docs>/pkg/", async () => {
    const res = await kits();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      docs: "https://ogs-docs.pages.dev",
      llms: "https://ogs-docs.pages.dev/llms.txt",
      quickstart: "https://ogs-docs.pages.dev/quickstart.md",
      kits: [
        {
          name: "@open-game-system/profile-kit",
          file: "profile-kit.tgz",
          url: "https://ogs-docs.pages.dev/pkg/profile-kit.tgz",
        },
        {
          name: "@open-game-system/cast-kit-core",
          file: "cast-kit-core.tgz",
          url: "https://ogs-docs.pages.dev/pkg/cast-kit-core.tgz",
        },
        {
          name: "@open-game-system/cast-kit-react",
          file: "cast-kit-react.tgz",
          url: "https://ogs-docs.pages.dev/pkg/cast-kit-react.tgz",
        },
        {
          name: "@open-game-system/try-kit",
          file: "try-kit.tgz",
          url: "https://ogs-docs.pages.dev/pkg/try-kit.tgz",
        },
      ],
    });
  });

  it("is cacheable for 5 minutes and needs no key", async () => {
    const res = await kits();
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("takes the docs base from OGS_DOCS_BASE (a trailing slash is dropped)", async () => {
    const body = await (await kits({ OGS_DOCS_BASE: "https://docs-preview.test/" })).json();
    expect(body).toMatchObject({
      docs: "https://docs-preview.test",
      llms: "https://docs-preview.test/llms.txt",
      quickstart: "https://docs-preview.test/quickstart.md",
      kits: expect.arrayContaining([
        expect.objectContaining({ url: "https://docs-preview.test/pkg/profile-kit.tgz" }),
      ]),
    });
  });

  it("an OGS_DOCS_BASE that isn't an http(s) URL is a server misconfiguration", async () => {
    const res = await kits({ OGS_DOCS_BASE: "not a url" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        code: "docs_base_invalid",
        message: "OGS_DOCS_BASE is not an http(s) URL",
        status: 500,
      },
    });
  });

  it("an http docs base (local dev) is fine, and every trailing slash is dropped", async () => {
    const res = await kits({ OGS_DOCS_BASE: "http://localhost:8788//" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ docs: "http://localhost:8788" });
  });

  it.each([
    "ftp://docs.example",
    "xhttp://docs.example",
    "httpsx://docs.example",
  ])("a docs base on another scheme (%s) is refused", async (base) => {
    expect((await kits({ OGS_DOCS_BASE: base })).status).toBe(500);
  });

  it("answers with the default docs base when the Worker has no bindings at all", async () => {
    const res = await app.request("/api/v1/dev/kits");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ docs: "https://ogs-docs.pages.dev" });
  });
});
