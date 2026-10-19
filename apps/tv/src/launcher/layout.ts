import {
  type Instance,
  type Manifest,
  playingView,
  type SuspendedGame,
  sittingName,
} from "@open-game-system/ogs-protocol";
import type { FocusRow } from "./focus-grid";

export type RowId = "continue" | "tonight" | "again" | "library";

export interface BoxModel {
  /** The manifest's HUD-free crop for cover and hero. */
  safe?: Manifest["art"]["safe"];
  itemId: string;
  appId: string;
  name: string;
  tagline: string;
  cover: string;
  hero: string;
  /** The status chip, e.g. "Paused Tuesday". Empty for a game you haven't started. */
  tag: string;
  /**
   * What tells the sitting apart: its resume point ("Mission 6"), else when it started ("Started
   * 7:42 PM", the phone's name for it). For a game not started, its tagline.
   */
  resume: string;
  /** The card's chip: when, without the status word ("Just now", "Thursday"); "" for no sitting. */
  chip: string;
  /** The sitting this box resumes (paused or tonight); none for a game from the library. */
  instanceId?: string;
}

export interface RowModel {
  id: RowId;
  title: string;
  boxes: BoxModel[];
}

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function clock(t: number): string {
  const d = new Date(t);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** "just now", "at 7:02", "yesterday", "Tuesday", "Sep 1". */
export function when(t: number, now: number): string {
  if (now - t < 2 * 60 * 1000) return "just now";
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days === 0) return `at ${clock(t)}`;
  if (days === 1) return "yesterday";
  const d = new Date(t);
  // Stryker disable next-line StringLiteral: equivalent, getDay() is always 0-6
  if (days < 7) return WEEKDAYS[d.getDay()] ?? "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** A card chip: "Just now", "Today 7:02", "Yesterday", "Thursday", "Sep 1". */
export function chipWhen(t: number, now: number): string {
  const w = when(t, now);
  return w.startsWith("at ") ? `Today ${w.slice(3)}` : w.charAt(0).toUpperCase() + w.slice(1);
}

/** An instance's resume point: a Tier 0 visit's title is only the game's name, so none. */
const instanceLabel = (i: Instance) => (i.source === "visit" ? "" : i.title || i.detail);

function box(
  game: Manifest,
  tag: string,
  resume: string,
  chip = "",
  instanceId?: string,
): BoxModel {
  return {
    ...(instanceId ? { instanceId } : {}),
    itemId: `game:${game.appId}`,
    appId: game.appId,
    name: game.name,
    tagline: game.tagline,
    cover: game.art.tile,
    hero: game.art.hero ?? game.art.tile,
    safe: game.art.safe,
    tag,
    resume,
    chip,
  };
}

/**
 * Boxes for the items whose TV game isn't placed yet, in order; each game is placed once, so the
 * focus ring is never ambiguous.
 */
function placer(tvGames: Map<string, Manifest>) {
  const placed = new Set<string>();
  return <T extends { appId: string }>(items: T[], boxOf: (g: Manifest, item: T) => BoxModel) =>
    items.flatMap((item) => {
      const g = tvGames.get(item.appId);
      if (!g || placed.has(item.appId)) return [];
      placed.add(item.appId);
      return [boxOf(g, item)];
    });
}

/** How long the TV offers Play again for the game played last. */
export const PLAY_AGAIN_MS = 30 * DAY;

/** The household's last game on this TV, played within PLAY_AGAIN_MS, whatever its status. */
export function lastPlayed(
  instances: Instance[],
  tvGames: Map<string, Manifest>,
  now: number,
): Instance | null {
  const recent = instances.filter(
    (i) => tvGames.has(i.appId) && now - i.updatedAt <= PLAY_AGAIN_MS,
  );
  return recent.reduce<Instance | null>((a, i) => (a && a.updatedAt >= i.updatedAt ? a : i), null);
}

/**
 * Status first: what you paused (Continue), what's on tonight (Tonight), then the rest of the
 * household's TV games (Library). Each game appears once, so the focus ring is never ambiguous.
 */
export function buildRows(input: {
  games: Manifest[];
  instances: Instance[];
  suspended: SuspendedGame[];
  now: number;
}): RowModel[] {
  const { now } = input;
  const tvGames = new Map(input.games.filter((g) => g.tv !== "none").map((g) => [g.appId, g]));
  const ttl = new Map(input.games.map((g) => [g.appId, g.instanceTtlMs]));
  const view = playingView(input.instances, {
    now,
    // Stryker disable next-line ArrayDeclaration: equivalent, no instance is called 'Stryker was here'
    liveInstanceIds: [],
    ttlFor: (appId) => ttl.get(appId) ?? 0,
  });
  const place = placer(tvGames);
  // Stryker disable next-line ArrayDeclaration: equivalent, a string item has no appId so take() skips it
  const section = (kind: string) => view.sections.find((s) => s.kind === kind)?.items ?? [];

  const cont = [
    ...place(input.suspended, (g, s) =>
      box(g, `Paused ${when(s.at, now)}`, sittingName(s, now), chipWhen(s.at, now), s.instanceId),
    ),
    ...place(section("paused"), (g, i) =>
      box(
        g,
        `Played ${when(i.updatedAt, now)}`,
        sittingName({ ...i, label: instanceLabel(i), at: i.updatedAt }, now),
        chipWhen(i.updatedAt, now),
        i.instanceId,
      ),
    ),
  ];
  const tonight = place(section("tonight"), (g, i) => {
    const tag = `Tonight at ${clock(i.startsAt ?? now)}`;
    const name = sittingName({ ...i, label: instanceLabel(i), at: i.updatedAt }, now);
    return box(g, tag, name, tag, i.instanceId);
  });
  // The second visit: the game played last comes next (its sitting may be long past its TTL).
  const last = lastPlayed(input.instances, tvGames, now);
  const again = place(last ? [last] : [], (g, i) =>
    box(g, `Played ${when(i.updatedAt, now)}`, g.tagline, chipWhen(i.updatedAt, now)),
  );
  const library = place(
    [...tvGames.keys()].map((appId) => ({ appId })),
    (g) => box(g, "", g.tagline),
  );
  const rows: RowModel[] = [
    { id: "continue", title: "Continue", boxes: cont },
    { id: "tonight", title: "Tonight", boxes: tonight },
    { id: "again", title: "Play again", boxes: again },
    { id: "library", title: "Library", boxes: library },
  ];
  return rows.filter((r) => r.boxes.length > 0);
}

export const focusRows = (rows: RowModel[]): FocusRow[] =>
  rows.map((r) => ({ id: r.id, items: r.boxes.map((b) => b.itemId) }));
