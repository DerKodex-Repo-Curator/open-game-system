import { describe, expect, it } from "vitest";
import { appJoinLink, loadJoin, stickerArt } from "./join-page";

// Acceptance: 2026-10-06-join-and-invite.feature, "An expired or unknown code" and "The join page
// offers the app". The page at opengame.org/join/<code> reads the couch from the API.

const preview = {
  code: "NT9WPH",
  tvName: "Living room TV",
  host: { name: "Mom", sticker: "bear" },
  couch: [
    { name: "Mom", sticker: "bear" },
    { name: "Sam", sticker: "owl" },
  ],
};

type Reply = { status: number; ok: boolean; json(): Promise<unknown> };
const reply = (status: number, body: unknown) => async (): Promise<Reply> => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

describe("loadJoin", () => {
  it("asks the API for the couch by its code", async () => {
    const asked: string[] = [];
    await loadJoin("https://api.test/", "nt9-wph", async (url: string) => {
      asked.push(String(url));
      return reply(200, preview)();
    });
    expect(asked).toEqual(["https://api.test/api/v1/join/NT9WPH"]);
  });

  it("is the couch when the API knows the code", async () => {
    expect(await loadJoin("https://api.test", "NT9WPH", reply(200, preview))).toEqual({
      kind: "couch",
      couch: preview,
    });
  });

  it("is gone for an expired or unknown code", async () => {
    const gone = { error: { code: "session_not_found", message: "x", status: 404 } };
    expect(await loadJoin("https://api.test", "NT9WPH", reply(404, gone))).toEqual({
      kind: "gone",
    });
  });

  it("is a bad code without asking when it can't be a TV code", async () => {
    const never = async (): Promise<Reply> => {
      throw new Error("asked");
    };
    expect(await loadJoin("https://api.test", "NT9", never)).toEqual({ kind: "bad" });
  });

  it("is offline when the API can't be reached or answers something else", async () => {
    const down = async (): Promise<Reply> => {
      throw new TypeError("Failed to fetch");
    };
    expect(await loadJoin("https://api.test", "NT9WPH", down)).toEqual({ kind: "offline" });
    expect(await loadJoin("https://api.test", "NT9WPH", reply(500, {}))).toEqual({
      kind: "offline",
    });
    expect(await loadJoin("https://api.test", "NT9WPH", reply(200, { nope: 1 }))).toEqual({
      kind: "offline",
    });
  });
});

describe("links", () => {
  it("opens the OGS app on that couch", () => {
    expect(appJoinLink("NT9WPH")).toBe("opengame://join/NT9WPH");
  });

  it("draws a sticker from the launcher's painted characters", () => {
    expect(stickerArt("https://ogs-tv.pages.dev/", "bear")).toBe(
      "https://ogs-tv.pages.dev/art/story-nook/char-bear.webp",
    );
    expect(stickerArt("https://ogs-tv.pages.dev", "../x")).toBeNull();
  });
});
