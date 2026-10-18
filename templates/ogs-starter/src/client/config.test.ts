import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import manifest from "../../ogs.manifest.json";
import { APP_ID } from "./config";

/** One appId everywhere: game tokens are signed for it, and the Worker rejects any other. */
describe("the appId", () => {
  it("is the same in the manifest, the pages and the Worker's OGS_APP_ID", () => {
    const jsonc = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const json = jsonc.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
    const wrangler = z
      .object({ vars: z.object({ OGS_APP_ID: z.string() }) })
      .parse(JSON.parse(json));
    expect(APP_ID).toBe(manifest.appId);
    expect(wrangler.vars.OGS_APP_ID).toBe(manifest.appId);
    expect(manifest.appId).toMatch(/^[a-z0-9-]+$/);
  });

  it("declares the static fields the OGS catalogue needs", () => {
    expect(manifest).toMatchObject({ shape: "couch", tv: "required" });
    expect(manifest).not.toHaveProperty("tvUrl"); // a room game: the phone declares /tv?room=…
  });
});
