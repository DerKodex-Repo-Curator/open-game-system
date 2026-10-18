import { z } from "zod";
import type { Inputs } from "../bets";

const Item = z.object({ score: z.number() });

/** Bet 3: the Show HN post's points from the public Hacker News API (HN_ITEM_ID, set once it's posted). */
export async function readHn(itemId: string | undefined, fetcher: (url: string) => Promise<Response> = fetch): Promise<Inputs["hn"]> {
  if (!itemId || !/^\d+$/.test(itemId)) return { points: null };
  try {
    const res = await fetcher(`https://hacker-news.firebaseio.com/v0/item/${itemId}.json`);
    const item = Item.safeParse(await res.json());
    return { points: item.success ? item.data.score : null };
  } catch {
    return { points: null };
  }
}
