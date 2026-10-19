import { parseArgs } from "node:util";
import { z } from "zod";
import { call, type Io, session } from "../io";

export const SummarySchema = z.object({
  ios: z.object({
    configured: z.boolean(),
    keyId: z.string().nullish(),
    teamId: z.string().nullish(),
    bundleId: z.string().nullish(),
  }),
  android: z.object({
    configured: z.boolean(),
    projectId: z.string().nullish(),
    clientEmail: z.string().nullish(),
    package: z.string().nullish(),
  }),
});

export async function credentials(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      app: { type: "string" },
      ios: { type: "string" },
      android: { type: "string" },
      "key-id": { type: "string" },
      "team-id": { type: "string" },
    },
  });
  const { appId, key } = session(io, values.app);
  if (values.ios && values["key-id"] && values["team-id"])
    await call(io, "PUT", `/api/v1/apps/${appId}/push-credentials`, key, {
      ios: { p8: io.readFile(values.ios), keyId: values["key-id"], teamId: values["team-id"] },
    });
  else if (values.android)
    await call(io, "PUT", `/api/v1/apps/${appId}/push-credentials`, key, {
      android: { serviceAccount: JSON.parse(io.readFile(values.android)) },
    });
  else {
    io.stderr(
      "Usage: ogs push credentials --ios <AuthKey.p8> --key-id <id> --team-id <id> | --android <service-account.json>",
    );
    return 2;
  }
  const s = SummarySchema.parse(
    await call(io, "GET", `/api/v1/apps/${appId}/push-credentials`, key),
  );
  io.stdout(
    s.ios.configured
      ? `ios: configured (key ${s.ios.keyId}, team ${s.ios.teamId}, ${s.ios.bundleId})`
      : "ios: not configured",
  );
  io.stdout(
    s.android.configured
      ? `android: configured (project ${s.android.projectId}, ${s.android.clientEmail}, ${s.android.package})`
      : "android: not configured",
  );
  return 0;
}
