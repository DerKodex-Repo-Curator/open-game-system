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

type NativeApp = z.infer<typeof NativeListSchema>["apps"][number];
type IosApp = Extract<NativeApp, { platform: "ios" }>;
type AndroidApp = Extract<NativeApp, { platform: "android" }>;
type Apps = { ios?: IosApp; android?: AndroidApp };

/** One line per check: `ok`, `FAIL` (the exit code becomes 1) or `--` (a note). */
type Report = {
  ok(line: string): void;
  fail(line: string): void;
  note(line: string): void;
  failed(): boolean;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function report(io: Io): Report {
  let failed = false;
  return {
    ok: (line) => io.stdout(`ok   ${line}`),
    fail: (line) => {
      failed = true;
      io.stdout(`FAIL ${line}`);
    },
    note: (line) => io.stdout(`--   ${line}`),
    failed: () => failed,
  };
}

async function checkApps(io: Io, r: Report, appId: string, key: string): Promise<Apps> {
  const apps = NativeListSchema.parse(
    await call(io, "GET", `/api/v1/apps/${appId}/native`, key),
  ).apps;
  const ios = apps.find((a): a is IosApp => a.platform === "ios");
  const android = apps.find((a): a is AndroidApp => a.platform === "android");
  if (!ios && !android)
    r.fail(
      `no app registered for ${appId}. Run: ogs apps register --ios <bundle id> --team-id <team id>`,
    );
  if (ios) r.ok(`ios app registered: ${ios.bundleId} (team ${ios.teamId})`);
  if (android) r.ok(`android app registered: ${android.package}`);
  return { ios, android };
}

async function checkCredentials(io: Io, r: Report, appId: string, key: string, apps: Apps) {
  const creds = SummarySchema.parse(
    await call(io, "GET", `/api/v1/apps/${appId}/push-credentials`, key),
  );
  if (apps.ios)
    creds.ios.configured
      ? r.ok(`ios push credentials: key ${creds.ios.keyId}`)
      : r.fail(
          `ios push credentials: none uploaded. Run: ogs push credentials --ios AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --team-id ${apps.ios.teamId}`,
        );
  if (apps.android)
    creds.android.configured
      ? r.ok(`android push credentials: project ${creds.android.projectId}`)
      : r.fail(
          "android push credentials: none uploaded. Run: ogs push credentials --android service-account.json",
        );
}

/** OGS's own file lists the app for /play/<appId>/*; the developer's own domain just lists the app. */
async function checkAasa(
  io: Io,
  r: Report,
  site: { url: string; own: boolean },
  appId: string,
  ios: IosApp,
) {
  const host = new URL(site.url).host;
  const appleAppId = `${ios.teamId}.${ios.bundleId}`;
  try {
    const aasa = AasaSchema.parse(
      await getJson(io, `${site.url}/.well-known/apple-app-site-association`),
    );
    const listed = aasa.applinks.details.some(
      (d) => d.appID === appleAppId && (site.own || d.paths.includes(`/play/${appId}/*`)),
    );
    listed
      ? r.ok(
          `${host} apple-app-site-association lists ${appleAppId}${site.own ? "" : ` for /play/${appId}/*`}`,
        )
      : r.fail(
          `${host} apple-app-site-association doesn't list ${appleAppId}${site.own ? " (add it to your domain's file)" : " yet (it updates within 5 minutes of registering)"}`,
        );
  } catch (e) {
    r.fail(`${host} apple-app-site-association: ${message(e)}`);
  }
}

async function checkAssetlinks(io: Io, r: Report, site: string, android: AndroidApp) {
  const host = new URL(site).host;
  try {
    const links = AssetlinksSchema.parse(await getJson(io, `${site}/.well-known/assetlinks.json`));
    links.some((l) => l.target.package_name === android.package)
      ? r.ok(`${host} assetlinks.json lists ${android.package}`)
      : r.fail(`${host} assetlinks.json doesn't list ${android.package}`);
  } catch (e) {
    r.fail(`${host} assetlinks.json: ${message(e)}`);
  }
}

/** OGS's link domain (OGS_SITE), then the developer's own (--domain). */
async function checkDomains(
  io: Io,
  r: Report,
  appId: string,
  domain: string | undefined,
  apps: Apps,
) {
  const ogsSite = io.env.OGS_SITE ?? DEFAULT_SITE;
  const domains = [ogsSite, ...(domain ? [`https://${domain.replace(/^https?:\/\//, "")}`] : [])];
  for (const url of domains) {
    if (apps.ios) await checkAasa(io, r, { url, own: url !== ogsSite }, appId, apps.ios);
    if (apps.android) await checkAssetlinks(io, r, url, apps.android);
  }
}

async function checkTvUrl(io: Io, r: Report, appId: string) {
  try {
    const game = CatalogueSchema.parse(await getJson(io, `${api(io)}/api/v1/catalogue`)).find(
      (g) => g.appId === appId,
    );
    if (!game)
      r.note(
        `${appId} isn't in the OGS catalogue (casting uses the TV page your phone page declares)`,
      );
    else if (!game.tvUrl)
      r.note("no tvUrl in the manifest (the TV shows the page your phone page declares)");
    else {
      const res = await io.fetch(game.tvUrl);
      res.ok
        ? r.ok(`tvUrl answers: ${game.tvUrl}`)
        : r.fail(`tvUrl ${game.tvUrl} answered HTTP ${res.status}`);
    }
  } catch (e) {
    r.fail(`catalogue: ${message(e)}`);
  }
}

export async function doctor(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { app: { type: "string" }, domain: { type: "string" } },
  });
  const { appId, key } = session(io, values.app);
  const r = report(io);
  const apps = await checkApps(io, r, appId, key);
  await checkCredentials(io, r, appId, key, apps);
  await checkDomains(io, r, appId, values.domain, apps);
  await checkTvUrl(io, r, appId);
  return r.failed() ? 1 : 0;
}
