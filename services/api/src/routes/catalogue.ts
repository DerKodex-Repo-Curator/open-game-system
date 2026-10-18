import { Hono } from "hono";
import { catalogueFor } from "../catalogue";
import { liveManifests } from "../lib/catalogue-entries";
import type { Env } from "../types";

const catalogue = new Hono<{ Bindings: Env }>();

/**
 * GET /api/v1/catalogue — every game OGS knows, as ogs-protocol manifests: the seed plus approved
 * catalogue entries (`ogs publish`). Public.
 */
catalogue.get("/", async (c) => c.json(catalogueFor(c.env, await liveManifests(c.env.DB))));

export default catalogue;
