import { z } from "zod";

/** A bare host name ("rocketcrew.tv"): no scheme, path, port or spaces. */
const HostSchema = z
  .string()
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "a bare host name like rocketcrew.tv",
  );

/**
 * The developer's shell config: `plugins: [["@open-game-system/shell", { … }]]` in app.config.
 * docs/design-docs/white-label-shell.md, "Contract between the pieces".
 */
export const ShellConfigSchema = z.object({
  /** The game's OGS catalogue id. */
  appId: z.string().regex(/^[a-z0-9-]+$/, "the game's OGS catalogue id (a-z, 0-9, -)"),
  /** The game's phone page, opened in the WebView. */
  gameUrl: z.url({ protocol: /^https$/, error: "an https:// URL" }),
  /** The app's name, as players see it (store name, permission prompts). */
  name: z.string().min(1),
  icon: z.string().min(1).optional(),
  splash: z
    .object({ image: z.string().min(1), backgroundColor: z.string().min(1).optional() })
    .optional(),
  /** OGS is invisible by default; "powered-by" shows the "Powered by OGS" mark. */
  branding: z.enum(["hidden", "powered-by"]).default("hidden"),
  /** The developer's own link domains; opengame.org/play/<appId> is always claimed as well. */
  linkDomains: z.array(HostSchema).default([]),
  cast: z.object({ receiver: z.literal("ogs") }).default({ receiver: "ogs" }),
});

export type ShellConfig = z.infer<typeof ShellConfigSchema>;
export type ShellConfigInput = z.input<typeof ShellConfigSchema>;

/** Parses the plugin's props; the error names the plugin and each bad field. */
export function parseShellConfig(input: unknown): ShellConfig {
  const result = ShellConfigSchema.safeParse(input);
  if (result.success) return result.data;
  const problems = result.error.issues
    .map((issue) => `${issue.path.join(".") || "(config)"}: ${issue.message}`)
    .join("; ");
  throw new Error(`@open-game-system/shell: invalid config. ${problems}`);
}
