import {
  type OgsNotification,
  type OgsPushData,
  OgsPushDataSchema,
} from "@open-game-system/ogs-protocol";

/** What the app knows when a push arrives in the foreground. */
export interface ForegroundContext {
  /** The game whose WebView is on screen, or null. */
  openAppId: string | null;
  /** Whether that page registered onOgsNotification. */
  listening: boolean;
}

/** The open game's page takes it: its own push, sent to be delivered, and the page listens. */
const pageTakes = (data: OgsPushData, ctx: ForegroundContext) =>
  data.whenOpen === "deliver" && ctx.listening && data.appId === ctx.openAppId;

const forPage = (
  data: OgsPushData,
  title: string | null,
  body: string | null,
): OgsNotification => ({
  title: title ?? "",
  body: body ?? "",
  url: data.url,
  ...(data.tag ? { tag: data.tag } : {}),
});

/**
 * Banner or the page (spec §9, "Arriving while the game is open"): a game push for the game that is
 * open and listening, sent with whenOpen "deliver", goes to the page and shows no banner. Everything
 * else (another game, no handler, whenOpen "banner", an invite) shows as a banner.
 */
export function foregroundDecision(
  push: { data: unknown; title: string | null; body: string | null },
  ctx: ForegroundContext,
): { banner: boolean; toPage: OgsNotification | null } {
  const parsed = OgsPushDataSchema.safeParse(push.data);
  if (!parsed.success || !pageTakes(parsed.data, ctx)) return { banner: true, toPage: null };
  return { banner: false, toPage: forPage(parsed.data, push.title, push.body) };
}
