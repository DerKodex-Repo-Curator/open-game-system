import { parseArgs } from "node:util";
import { z } from "zod";
import { call, type Io, session } from "../io";
import { MANIFEST_FILE, printIssues, readManifestJson, validate } from "../manifest";

const SubmittedSchema = z.object({
  appId: z.string(),
  status: z.literal("pending"),
  submittedAt: z.number(),
});

const Listed = z.object({ name: z.string(), startUrl: z.string() });
const StatusSchema = z.object({
  appId: z.string(),
  status: z.enum(["pending", "live", "rejected", "none"]),
  submittedAt: z.number().optional(),
  reviewedAt: z.number().optional(),
  note: z.string().optional(),
  live: Listed.optional(),
  pending: Listed.optional(),
});

const at = (ms: number | undefined) => (ms === undefined ? "" : new Date(ms).toISOString());

function printStatus(io: Io, s: z.infer<typeof StatusSchema>) {
  if (s.status === "none") {
    io.stdout(`${s.appId}: not submitted yet. Run: ogs publish`);
    return;
  }
  io.stdout(
    s.status === "pending"
      ? `${s.appId}: pending review (submitted ${at(s.submittedAt)})`
      : s.status === "live"
        ? `${s.appId}: live in the catalogue (approved ${at(s.reviewedAt)})`
        : `${s.appId}: rejected (reviewed ${at(s.reviewedAt)})`,
  );
  if (s.note) io.stdout(`note: ${s.note}`);
  if (s.live) io.stdout(`live: ${s.live.name} (${s.live.startUrl})`);
  if (s.pending) io.stdout(`pending: ${s.pending.name} (${s.pending.startUrl})`);
}

/**
 * ogs publish [file] [--status]: submits the manifest (validated locally first) as the game's
 * catalogue entry, for review (PUT /api/v1/apps/:appId/catalogue-entry, the game's key); --status
 * prints where the entry stands (GET the same).
 */
export async function publish(io: Io, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { app: { type: "string" }, status: { type: "boolean" } },
  });
  if (values.status) {
    const { appId, key } = session(io, values.app);
    printStatus(
      io,
      StatusSchema.parse(await call(io, "GET", `/api/v1/apps/${appId}/catalogue-entry`, key)),
    );
    return 0;
  }
  const raw = readManifestJson(io, positionals[0] ?? MANIFEST_FILE);
  const local = validate(raw);
  if ("issues" in local) return printIssues(io, local.issues);
  const { appId, key } = session(io, values.app);
  const submitted = SubmittedSchema.parse(
    await call(io, "PUT", `/api/v1/apps/${appId}/catalogue-entry`, key, raw),
  );
  io.stdout(`${submitted.appId}: pending review (submitted ${at(submitted.submittedAt)})`);
  io.stdout("See where it stands: ogs publish --status");
  return 0;
}
