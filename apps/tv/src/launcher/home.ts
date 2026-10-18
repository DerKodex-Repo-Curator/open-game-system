import {
  type Instance,
  type Manifest,
  playItem,
  type SuspendedGame,
} from "@open-game-system/ogs-protocol";
import { type Dir, type FocusRow, firstFocus, locate, move } from "./focus-grid";
import { buildRows } from "./layout";
import { pickSurprise } from "./shortcuts";

export interface Art {
  src: string;
  /** The HUD crop: only ever on captured gameplay art, never on the clean kit. */
  safe?: Manifest["art"]["safe"];
  /** A gameplay capture (no clean kit art): it may carry the game's own captions. */
  captured?: true;
}

export interface IconModel {
  itemId: string;
  appId: string;
  name: string;
  tagline: string;
  icon: Art;
  room: Art;
  logo: string | null;
  /** "Paused Thursday", "Tonight at 8:00", or "" for a game not started. */
  tag: string;
  resume: string;
}

export type CardModel =
  | {
      kind: "sitting";
      itemId: string;
      appId: string;
      name: string;
      art: Art;
      tag: string;
      /** Its resume point, else when it started: what tells it from another sitting. */
      resume: string;
      /** When, short ("Just now", "Thursday"): the row already says these are sittings. */
      chip: string;
      /** Tonight's game night: on the calendar, not a sitting to continue. */
      upcoming: boolean;
    }
  | {
      /** The game played last (its sitting over or long silent): OK starts a new game of it. */
      kind: "again";
      itemId: string;
      appId: string;
      name: string;
      art: Art;
      /** "Play again". */
      tag: string;
      /** When it was played, short ("Yesterday", "Thursday"). */
      chip: string;
    }
  | {
      kind: "surprise";
      /** `play:<pick>`: OK starts the picked game at once. */
      itemId: string;
      /** The game this visit's Surprise me starts (never the one just played, when there is another). */
      appId: string;
      /** Its own picture (a gift box of dice) and its own room, drawn for it. */
      art: Art;
      room: Art;
      /** The games Surprise me picks from: the kid-friendly ones. */
      pool: string[];
    };

export interface HomeModel {
  icons: IconModel[];
  cards: CardModel[];
}

export const SURPRISE_ART = {
  card: { src: "/art/surprise/card.jpg" },
  room: { src: "/art/surprise/room.jpg" },
} satisfies Record<string, Art>;

/** Two sittings and Surprise me: three large cards (the icons carry every other game). */
const MAX_SITTINGS = 2;

const captured = (src: string, safe: Manifest["art"]["safe"]): Art =>
  safe ? { src, safe, captured: true } : { src, captured: true };

/** The focused game's art for the whole room: the clean hero, else the captured hero cropped. */
export const roomArt = (g: Manifest): Art =>
  g.art.heroClean ? { src: g.art.heroClean } : captured(g.art.hero ?? g.art.tile, g.art.safe);

/** For the kids: the shop's ages start at 5 or under ("2+"), or the game doesn't say. */
export function forKids(g: Manifest): boolean {
  const m = g.shop.ages ? /^(\d+)/.exec(g.shop.ages) : null;
  return m?.[1] ? Number(m[1]) <= 5 : true;
}

/** The square icon, else the captured tile cropped. */
export const iconArt = (g: Manifest): Art =>
  g.art.icon ? { src: g.art.icon } : captured(g.art.tile, g.art.safe);

/**
 * PS5-style home: one row of game icons (paused sittings first, then tonight, then the rest),
 * and activity cards under it: the sittings to jump back into, then Surprise me.
 */
export function buildHome(input: {
  games: Manifest[];
  instances: Instance[];
  suspended: SuspendedGame[];
  now: number;
  /** 0..1, rolled once per visit home: which kids' game Surprise me starts. */
  surpriseSeed?: number;
}): HomeModel {
  const rows = buildRows(input);
  const byId = new Map(input.games.map((g) => [g.appId, g]));
  const boxes = rows.flatMap((r) => r.boxes);
  const icons: IconModel[] = boxes.flatMap((b) => {
    const g = byId.get(b.appId);
    // Stryker disable next-line ConditionalExpression,ArrayDeclaration: equivalent, every box comes from input.games
    if (!g) return [];
    return [
      {
        itemId: b.itemId,
        appId: b.appId,
        name: b.name,
        tagline: b.tagline,
        icon: iconArt(g),
        room: roomArt(g),
        logo: g.art.logo ?? null,
        tag: b.tag,
        resume: b.resume,
      },
    ];
  });
  // Stryker disable next-line MethodExpression: equivalent, the flatMap below drops boxes without a sitting too
  const cards: CardModel[] = boxes
    .filter((b) => b.instanceId)
    .slice(0, MAX_SITTINGS)
    .flatMap((b) => {
      const g = byId.get(b.appId);
      // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent, the filter above keeps only boxes with a sitting, all from input.games
      return g && b.instanceId
        ? [
            {
              kind: "sitting" as const,
              itemId: playItem(b.appId, b.instanceId),
              appId: b.appId,
              name: b.name,
              art: roomArt(g),
              tag: b.tag,
              resume: b.resume,
              chip: b.chip,
              upcoming: b.tag.startsWith("Tonight"),
            },
          ]
        : // Stryker disable next-line ArrayDeclaration: equivalent, unreachable after the filter above
          [];
    });
  // Play again comes first: the game played last, when Continue doesn't already hold it.
  const again = rows.find((r) => r.id === "again")?.boxes[0];
  const againGame = again ? byId.get(again.appId) : undefined;
  if (again && againGame)
    cards.unshift({
      kind: "again",
      itemId: playItem(again.appId),
      appId: again.appId,
      name: again.name,
      art: roomArt(againGame),
      tag: "Play again",
      chip: again.chip,
    });
  // Surprise me sits right after the latest sitting: the kids' button is never at the far end.
  const kids = icons.filter((i) => {
    const g = byId.get(i.appId);
    // Stryker disable next-line BooleanLiteral: equivalent, every icon's game is in input.games
    return g ? forKids(g) : false;
  });
  // Never the game just played: neither the latest pause nor the Play again card's game.
  const recent = input.suspended[0]?.appId ?? again?.appId ?? null;
  const pick = pickSurprise(kids, recent, () => input.surpriseSeed ?? 0);
  if (kids.length >= 2 && pick)
    cards.splice(Math.min(1, cards.length), 0, {
      kind: "surprise",
      itemId: playItem(pick),
      appId: pick,
      art: SURPRISE_ART.card,
      room: SURPRISE_ART.room,
      pool: kids.map((i) => i.appId),
    });
  return { icons, cards };
}

export const homeFocusRows = (home: HomeModel): FocusRow[] => [
  { id: "games", items: home.icons.map((i) => i.itemId) },
  { id: "activity", items: home.cards.map((c) => c.itemId) },
];

/** Where the ring goes when its item left the screen (a page closed): that game, else the first. */
export function recoverFocus(
  rows: FocusRow[],
  focus: string | null,
  lastPage: string | null,
): string | null {
  if (locate(rows, focus)) return null;
  const back = lastPage ? `game:${lastPage}` : null;
  return back && locate(rows, back) ? back : firstFocus(rows);
}

/**
 * The remote on home: along a row as the focus grid moves; down from the icons to the first card
 * (the latest sitting), and back up to the icon the ring came from (`lastIcon`), PS5-style.
 */
export function homeMove(
  rows: FocusRow[],
  focus: string | null,
  dir: Dir,
  lastIcon: string | null,
): string | null {
  // Row 0 is the icons, row 1 the cards.
  const step = `${locate(rows, focus)?.row}:${dir}`;
  if (step === "0:down") return firstCard(rows) ?? focus;
  if (step === "1:up") return iconAbove(rows, lastIcon) ?? focus;
  return move(rows, focus, dir);
}

/** The latest sitting's card. */
const firstCard = (rows: FocusRow[]): string | undefined => rows[1]?.items[0];

/** The icon the ring came down from, while it is still on screen; else the first icon. */
function iconAbove(rows: FocusRow[], lastIcon: string | null): string | undefined {
  // Stryker disable next-line OptionalChaining,ArrayDeclaration: equivalent, reached only from row 1, so row 0 exists
  const icons = rows[0]?.items ?? [];
  return lastIcon && icons.includes(lastIcon) ? lastIcon : icons[0];
}
