import { parseArgs } from "node:util";
import { z } from "zod";
import { api, call, DEFAULT_SITE, getJson, type Io, session } from "../io";

import { SummarySchema } from "./push";

const NativeListSchema = z.object({
  apps: z.array(
    z.discriminatedUnion("platform", [
      z.object({ platform: z.literal("ios"), bundleId: z.string(), teamId: z.string() }),
      z.object({
        platform: z.literal("android"),
        package: z.string(),
        sha256CertFingerprints: z.array(z.string()),
      }),
    ]),
  ),
});
const AasaSchema = z.object({
  applinks: z.object({
    details: z.array(z.object({ appID: z.string(), paths: z.array(z.string()) })),
  }),
});
const AssetlinksSchema = z.array(
  z.object({ target: z.object({ package_name: z.string().optional() }) }),
);
const CatalogueSchema = z.array(z.looseObject({ appId: z.string(), tvUrl: z.string().optional() }));

export async function doctor(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { app: { type: "string" }, domain: { type: "string" } },
  });
  const { appId, key } = session(io, values.app);
  let failed = false;
  const ok = (line: string) => io.stdout(`ok   ${line}`);
  const fail = (line: string) => {
    failed = true;
    io.stdout(`FAIL ${line}`);
  };
  const note = (line: string) => io.stdout(`--   ${line}`);

  const apps = NativeListSchema.parse(
    await call(io, "GET", `/api/v1/apps/${appId}/native`, key),
  ).apps;
  const ios = apps.find((a) => a.platform === "ios");
  const android = apps.find((a) => a.platform === "android");
  if (!ios && !android)
    fail(
      `no app registered for ${appId}. Run: ogs apps register --ios <bundle id> --team-id <team id>`,
    );
  if (ios?.platform === "ios") ok(`ios app registered: ${ios.bundleId} (team ${ios.teamId})`);
  if (android?.platform === "android") ok(`android app registered: ${android.package}`);

  const creds = SummarySchema.parse(
    await call(io, "GET", `/api/v1/apps/${appId}/push-credentials`, key),
  );
  if (ios?.platform === "ios")
    creds.ios.configured
      ? ok(`ios push credentials: key ${creds.ios.keyId}`)
      : fail(
          `ios push credentials: none uploaded. Run: ogs push credentials --ios AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --team-id ${ios.teamId}`,
        );
  if (android?.platform === "android")
    creds.android.configured
      ? ok(`android push credentials: project ${creds.android.projectId}`)
      : fail(
          "android push credentials: none uploaded. Run: ogs push credentials --android service-account.json",
        );

  const domains = [
    io.env.OGS_SITE ?? DEFAULT_SITE,
    ...(values.domain ? [`https://${values.domain.replace(/^https?:\/\//, "")}`] : []),
  ];
  for (const site of domains) {
    const host = new URL(site).host;
    const own = site !== (io.env.OGS_SITE ?? DEFAULT_SITE);
    if (ios?.platform === "ios") {
      const appleAppId = `${ios.teamId}.${ios.bundleId}`;
      try {
        const aasa = AasaSchema.parse(
          await getJson(io, `${site}/.well-known/apple-app-site-association`),
        );
        const listed = aasa.applinks.details.some(
          (d) => d.appID === appleAppId && (own || d.paths.includes(`/play/${appId}/*`)),
        );
        listed
          ? ok(
              `${host} apple-app-site-association lists ${appleAppId}${own ? "" : ` for /play/${appId}/*`}`,
            )
          : fail(
              `${host} apple-app-site-association doesn't list ${appleAppId}${own ? " (add it to your domain's file)" : " yet (it updates within 5 minutes of registering)"}`,
            );
      } catch (e) {
        fail(`${host} apple-app-site-association: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (android?.platform === "android") {
      try {
        const links = AssetlinksSchema.parse(
          await getJson(io, `${site}/.well-known/assetlinks.json`),
        );
        links.some((l) => l.target.package_name === android.package)
          ? ok(`${host} assetlinks.json lists ${android.package}`)
          : fail(`${host} assetlinks.json doesn't list ${android.package}`);
      } catch (e) {
        fail(`${host} assetlinks.json: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  try {
    const game = CatalogueSchema.parse(await getJson(io, `${api(io)}/api/v1/catalogue`)).find(
      (g) => g.appId === appId,
    );
    if (!game)
      note(
        `${appId} isn't in the OGS catalogue (casting uses the TV page your phone page declares)`,
      );
    else if (!game.tvUrl)
      note("no tvUrl in the manifest (the TV shows the page your phone page declares)");
    else {
      const res = await io.fetch(game.tvUrl);
      res.ok
        ? ok(`tvUrl answers: ${game.tvUrl}`)
        : fail(`tvUrl ${game.tvUrl} answered HTTP ${res.status}`);
    }
  } catch (e) {
    fail(`catalogue: ${e instanceof Error ? e.message : String(e)}`);
  }
  return failed ? 1 : 0;
}
