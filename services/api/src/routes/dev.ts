import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../lib/http";
import type { Env } from "../types";

/**
 * The developer tool's public routes (docs/design-docs/ogs-cli.md, "ogs init"). GET /kits says where
 * the docs and the kit tarballs are; `ogs init` downloads every kit listed into the game's vendor/.
 */
const dev = new Hono<{ Bindings: Env }>();

const DEFAULT_DOCS = "https://ogs-docs.pages.dev";
const KITS = ["profile-kit", "cast-kit-core", "cast-kit-react", "try-kit"];
const DocsBaseSchema = z.url({ protocol: /^https?$/ });

dev.get("/kits", (c) => {
  const parsed = DocsBaseSchema.safeParse(c.env?.OGS_DOCS_BASE ?? DEFAULT_DOCS);
  if (!parsed.success)
    return apiError(c, 500, "docs_base_invalid", "OGS_DOCS_BASE is not an http(s) URL");
  const docs = parsed.data.replace(/\/+$/, "");
  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    docs,
    llms: `${docs}/llms.txt`,
    quickstart: `${docs}/quickstart.md`,
    kits: KITS.map((kit) => ({
      name: `@open-game-system/${kit}`,
      file: `${kit}.tgz`,
      url: `${docs}/pkg/${kit}.tgz`,
    })),
  });
});

export default dev;
