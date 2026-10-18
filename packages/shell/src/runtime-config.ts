import { z } from "zod";
import type { ShellRuntimeConfig } from "./shell-runtime";

/** The OGS API production apps talk to (apps/mobile eas.json, production profile). */
export const DEFAULT_OGS_API = "https://opengame-api.jonathanrmumm.workers.dev";

const ExpoConfigSchema = z.object({
  name: z.string().min(1),
  extra: z.object({
    ogsShell: z.object({
      appId: z.string().min(1),
      gameUrl: z.string().regex(/^https:\/\//, "an https:// URL"),
      branding: z.enum(["hidden", "powered-by"]).default("hidden"),
      linkDomains: z.array(z.string()).default([]),
      apiBase: z
        .string()
        .regex(/^https?:\/\//)
        .optional(),
      tvBase: z
        .string()
        .regex(/^https?:\/\//)
        .optional(),
    }),
  }),
});

export type OgsShellConfig = ShellRuntimeConfig & { branding: "hidden" | "powered-by" };

/** The shell config the plugin wrote to `extra.ogsShell` (read from Constants.expoConfig). */
export function readRuntimeConfig(expoConfig: unknown): OgsShellConfig {
  const parsed = ExpoConfigSchema.safeParse(expoConfig);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(expo config)"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `@open-game-system/shell: no shell config in the app (add the plugin to app.config). ${problems}`,
    );
  }
  const { name, extra } = parsed.data;
  const { apiBase, tvBase, ...shell } = extra.ogsShell;
  return { ...shell, name, apiBase: apiBase ?? DEFAULT_OGS_API, ...(tvBase ? { tvBase } : {}) };
}
