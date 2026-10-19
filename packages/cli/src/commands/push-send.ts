import { parseArgs } from "node:util";
import { z } from "zod";
import { CliError, call, type Io, list, session } from "../io";

/**
 * `ogs push send`: a test push (or push link) to player handles through the real send API
 * (POST /api/v1/games/:appId/notifications); `--check` asks where each would go instead
 * (GET /api/v1/games/:appId/push-handles/:handle) and sends nothing.
 */
const ResultsSchema = z.object({
  results: z.array(z.object({ to: z.string(), status: z.string() })),
});
const HandleSchema = z.object({
  handle: z.string(),
  surfaces: z.array(z.object({ kind: z.enum(["ogs", "web", "app"]), lastActiveAt: z.string() })),
});
const WhenOpenSchema = z.enum(["deliver", "banner"]);

export const PUSH_SEND_USAGE =
  "ogs push send --to <handle>[,<handle>] [--title <t>] [--body <b>] [--url <link>] [--when-open deliver|banner] [--check]";

async function check(io: Io, appId: string, key: string, handles: string[]): Promise<number> {
  let reachable = true;
  for (const handle of handles) {
    try {
      const h = HandleSchema.parse(
        await call(
          io,
          "GET",
          `/api/v1/games/${appId}/push-handles/${encodeURIComponent(handle)}`,
          key,
        ),
      );
      if (h.surfaces.length === 0) reachable = false;
      io.stdout(
        h.surfaces.length === 0
          ? `${handle}  nowhere: no surface left (the player opts in again)`
          : `${handle}  ${h.surfaces.map((s) => `${s.kind} (last active ${s.lastActiveAt})`).join(", then ")}`,
      );
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      reachable = false;
      io.stdout(`${handle}  ${e.message}`);
    }
  }
  return reachable ? 0 : 1;
}

/** The send API's body: a default title and body for a test push; the link only when given. */
const notification = (
  to: string[],
  values: { title?: string; body?: string; url?: string },
  whenOpen: z.infer<typeof WhenOpenSchema>,
) => ({
  to,
  title: values.title ?? "Test push",
  body: values.body ?? "A test push from ogs push send.",
  ...(values.url ? { url: values.url } : {}),
  whenOpen,
});

export async function send(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      app: { type: "string" },
      to: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      url: { type: "string" },
      "when-open": { type: "string" },
      check: { type: "boolean", default: false },
    },
  });
  const handles = list(values.to);
  const whenOpen = WhenOpenSchema.safeParse(values["when-open"] ?? "deliver");
  if (handles.length === 0 || !whenOpen.success) {
    io.stderr(`Usage: ${PUSH_SEND_USAGE}`);
    return 2;
  }
  const { appId, key } = session(io, values.app);
  if (values.check) return check(io, appId, key, handles);
  const { results } = ResultsSchema.parse(
    await call(
      io,
      "POST",
      `/api/v1/games/${appId}/notifications`,
      key,
      notification(handles, values, whenOpen.data),
    ),
  );
  for (const r of results) io.stdout(`${r.to}  ${r.status}`);
  return results.every((r) => r.status === "sent") ? 0 : 1;
}
