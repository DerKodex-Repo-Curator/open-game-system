import { Hono } from "hono";
import { catalogueFor } from "../catalogue";
import { withTryUrls } from "../lib/try-paths";
import type { Env } from "../types";

const catalogue = new Hono<{ Bindings: Env }>();

/** GET /api/v1/catalogue — every game OGS knows, as ogs-protocol manifests (with each game's registered try path as tryUrl). Public. */
catalogue.get("/", async (c) => c.json(await withTryUrls(c.env.DB, catalogueFor(c.env))));

export default catalogue;
