import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** apps/docs */
export const DOCS_ROOT = resolve(here, "..");
/** The monorepo root. */
export const REPO_ROOT = resolve(DOCS_ROOT, "../..");
export const CONTENT_DIR = resolve(DOCS_ROOT, "content");
export const DIST_DIR = resolve(DOCS_ROOT, "dist");
/** The contract page is rendered from this file (single source of truth). */
export const SPEC_FILE = resolve(REPO_ROOT, "docs/specification.md");

/**
 * Where the site is served (Cloudflare Pages project `ogs-docs`). A preview build sets
 * DOCS_SITE_URL to its own URL, so its llms.txt and prompts point at itself.
 */
export const SITE_URL = (process.env.DOCS_SITE_URL ?? "https://ogs-docs.pages.dev").replace(/\/+$/, "");
/** Repo files the docs link to are linked on GitHub at this ref. */
export const REPO_BLOB_URL = "https://github.com/open-game-system/open-game-system/blob/main";
