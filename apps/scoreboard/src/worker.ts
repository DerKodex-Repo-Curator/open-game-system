import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { access } from "./access";
import { addSnapshot, gather, type Health, type Windows } from "./board";
import { render } from "./render";
import { snapshotOf, type Snapshot } from "./sources/frontdoor";
import { readHn } from "./sources/hn";
import { recentTotals } from "./sources/counters";
import { datapointsFrom } from "./tail";
import { getAppRedirect } from "./get-app";
import { EMPTY_MANUAL, ManualSchema, parseManual, type Manual } from "./manual";

/** The front door's Tally Durable Object (apps/front-door), read over RPC: `summary()` only. */
interface TallyRpc extends Rpc.DurableObjectBranded {
  summary(appIds: readonly string[]): Promise<unknown>;
}

interface Env {
  /** Workers Logs, through the Analytics SQL binding (no API token). */
  ANALYTICS_SQL: AnalyticsSQLBinding;
  /** opengame-api's D1, read-only (couch_sessions, family_invites). */
  API_DB: D1Database;
  /** ogs-docs' waitlist D1, read-only. */
  WAITLIST_DB: D1Database;
  /** ogs-front-door's Tally (script_name binding). */
  TALLY: DurableObjectNamespace<TallyRpc>;
  BOARD: DurableObjectNamespace<Board>;
  SCOREBOARD_KEY: string;
  /** The Show HN post's item id, once it's up. */
  HN_ITEM_ID?: string;
  /** Exact counters: the tailed try Workers, /get-app taps, docs downloads. */
  TRY_EVENTS: AnalyticsEngineDataset;
  /** The public TestFlight link, once Jon has one (/get-app sends people there). */
  TESTFLIGHT_URL?: string;
  /** "1" once the docs site counts its downloads (branch claude/docs-download-count deployed). */
  DOCS_DOWNLOADS_LIVE?: string;
}

const Stored = z.object({ windows: z.record(z.string(), z.unknown()), updatedAt: z.string(), health: z.record(z.string(), z.string()).default({}) });

/** Holds the front door's snapshots and the last gathered board. One instance. */
export class Board extends DurableObject<Env> {
  /** Snapshots the front door's totals, reads every source and stores the board. */
  async refresh(): Promise<void> {
    const now = new Date();
    let snapshots = (await this.ctx.storage.get<Snapshot[]>("snapshots")) ?? [];
    const health: Health = {};
    try {
      const tally = this.env.TALLY.get(this.env.TALLY.idFromName("front-door"));
      const snap = snapshotOf(await tally.summary([]), now);
      snapshots = addSnapshot(snapshots, snap);
      await this.ctx.storage.put("snapshots", snapshots);
      const total = Object.values(snap.bySource).reduce((n, s) => n + s.view, 0);
      health.tally = `ok: ${snapshots.length} snapshots since ${snapshots[0]?.at ?? "now"}; ${total} visits in the tally so far`;
    } catch (e) {
      health.tally = String(e).slice(0, 300);
      console.error({ event: "scoreboard.tally_failed", error: { type: "TallyError", message: health.tally } });
    }
    const windows = await gather(
      {
        api: this.env.API_DB,
        waitlist: this.env.WAITLIST_DB,
        sql: this.env.ANALYTICS_SQL,
        hn: () => readHn(this.env.HN_ITEM_ID),
        manual: await this.manual(),
        downloadsLive: this.env.DOCS_DOWNLOADS_LIVE === "1",
      },
      snapshots,
      now,
      health,
    );
    try {
      health.counters = `${health.counters ?? "ok"}: ${await recentTotals(this.env.ANALYTICS_SQL, now)}`;
    } catch (e) {
      health.counters = String(e).slice(0, 300);
    }
    await this.ctx.storage.put("board", { windows, updatedAt: now.toISOString(), health });
    console.info({ event: "scoreboard.refreshed", snapshots: snapshots.length, ...health });
  }

  async manual(): Promise<Manual> {
    const stored = ManualSchema.safeParse(await this.ctx.storage.get("manual"));
    return stored.success ? stored.data : EMPTY_MANUAL;
  }

  /** Jon's typed-in numbers; the board re-reads with them. */
  async saveManual(manual: Manual): Promise<void> {
    await this.ctx.storage.put("manual", manual);
    await this.refresh();
  }

  async page(): Promise<string> {
    const stored = Stored.safeParse(await this.ctx.storage.get("board"));
    const manual = await this.manual();
    if (!stored.success) return render({}, new Date(), "never (the first refresh runs within 15 minutes)", {}, manual);
    // Stored by refresh() from gather(): the same shape it was written in.
    const windows: Windows = Object.fromEntries(Object.entries(stored.data.windows).flatMap(([k, v]) => (isInputs(v) ? [[k, v]] : [])));
    return render(windows, new Date(), new Date(stored.data.updatedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT", stored.data.health, manual);
  }
}

function isInputs(v: unknown): v is Windows[string] {
  return typeof v === "object" && v !== null && "funnel" in v && "frontDoor" in v && "tryGames" in v && "waitlist" in v && "hn" in v;
}

const board = (env: Env) => env.BOARD.get(env.BOARD.idFromName("board"));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Public: count a "get the app" tap, then send it on (handouts, invites, the front door link here).
    if (url.pathname === "/get-app") return getAppRedirect(url, env.TESTFLIGHT_URL, env.TRY_EVENTS);
    const a = access(req, env.SCOREBOARD_KEY ?? "");
    if (!a.ok) return new Response("Not found", { status: 404 });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
    if (a.setCookie) headers.append("set-cookie", a.setCookie);
    if (url.pathname === "/refresh" && req.method === "POST") {
      await board(env).refresh();
      return new Response(null, { status: 303, headers: { location: "/", ...(a.setCookie ? { "set-cookie": a.setCookie } : {}) } });
    }
    if (url.pathname === "/manual" && req.method === "POST") {
      const form = new URLSearchParams(await req.text());
      await board(env).saveManual(parseManual(form, new Date().toISOString()));
      return new Response(null, { status: 303, headers: { location: "/" } });
    }
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    return new Response(await board(env).page(), { headers });
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await board(env).refresh();
  },
  /** Tail of the try Workers (their [env.try] tail_consumers): every log, unsampled → exact counters. */
  async tail(events: TraceItem[], env: Env): Promise<void> {
    for (const point of datapointsFrom(events)) env.TRY_EVENTS.writeDataPoint(point);
  },
} satisfies ExportedHandler<Env>;
