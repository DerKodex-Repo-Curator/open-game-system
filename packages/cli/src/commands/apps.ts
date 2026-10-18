import { parseArgs } from "node:util";
import { call, type Io, list, session } from "../io";

export async function register(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      app: { type: "string" },
      ios: { type: "string" },
      android: { type: "string" },
      "team-id": { type: "string" },
      sha256: { type: "string" },
      "google-client-id": { type: "string" },
    },
  });
  const { appId, key } = session(io, values.app);
  if (values.ios && values["team-id"]) {
    await call(io, "PUT", `/api/v1/apps/${appId}/native/ios`, key, {
      bundleId: values.ios,
      teamId: values["team-id"],
    });
    io.stdout(`Registered ios app ${values.ios} for ${appId}.`);
    return 0;
  }
  if (values.android && values.sha256) {
    await call(io, "PUT", `/api/v1/apps/${appId}/native/android`, key, {
      package: values.android,
      sha256CertFingerprints: list(values.sha256),
      googleClientIds: list(values["google-client-id"]),
    });
    io.stdout(`Registered android app ${values.android} for ${appId}.`);
    return 0;
  }
  io.stderr(
    "Usage: ogs apps register --ios <bundle id> --team-id <team id> | --android <package> --sha256 <fingerprint,...>",
  );
  return 2;
}
