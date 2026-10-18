import { join } from "node:path";
import { parseArgs } from "node:util";
import { call, configDir, type Io, readCredentials, saveCredentials } from "../io";

export async function login(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { app: { type: "string" }, key: { type: "string" } },
  });
  if (!values.app || !values.key) {
    io.stderr("Usage: ogs login --app <appId> --key <game API key>");
    return 2;
  }
  await call(io, "GET", `/api/v1/apps/${values.app}/native`, values.key);
  const creds = readCredentials(io);
  saveCredentials(io, {
    currentApp: values.app,
    apps: { ...creds.apps, [values.app]: { key: values.key } },
  });
  io.stdout(
    `Logged in for ${values.app}. The key is saved in ${join(configDir(io), "credentials.json")}.`,
  );
  return 0;
}
