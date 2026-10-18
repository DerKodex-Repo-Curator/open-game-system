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
});
