import { z } from "zod";
import { api, CliError, type Io } from "../io";

/** GET /api/v1/dev/kits: where the docs are and which kit tarballs a game vendors. */
export const KitsSchema = z.object({
  docs: z.string(),
  llms: z.string(),
  quickstart: z.string(),
  kits: z.array(
    z.object({
      name: z.string().regex(/^@open-game-system\/[a-z0-9-]+$/),
      file: z.string().regex(/^[a-z0-9-]+\.tgz$/),
      url: z.url({ protocol: /^https?$/ }),
    }),
  ),
});
export type Kits = z.infer<typeof KitsSchema>;
export type Kit = Kits["kits"][number];

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
});

export async function fetchKits(io: Io): Promise<Kits> {
  const res = await io.fetch(`${api(io)}/api/v1/dev/kits`);
  if (!res.ok) {
    const parsed = ErrorBodySchema.safeParse(await res.json().catch(() => null));
    throw new CliError(
      parsed.success
        ? `${parsed.data.error.code}: ${parsed.data.error.message ?? ""}`.trim()
        : `GET /api/v1/dev/kits answered HTTP ${res.status}`,
    );
  }
  return KitsSchema.parse(await res.json());
}

/** The kit's tarball; refuses anything that isn't gzip (a docs site's HTML fallback, say). */
export async function downloadKit(io: Io, kit: Kit): Promise<Uint8Array> {
  const res = await io.fetch(kit.url);
  if (!res.ok) throw new CliError(`${kit.name}: ${kit.url} answered HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    throw new CliError(`${kit.name}: ${kit.url} isn't a .tgz (not gzip)`);
  return bytes;
}
