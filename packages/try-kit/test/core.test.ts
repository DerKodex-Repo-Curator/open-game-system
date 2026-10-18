import { describe, expect, it } from "vitest";
import {
  IDLE_MS,
  isControllerDevice,
  joinGate,
  newRoomCode,
  offerThisComputer,
  parseRef,
  parseRoomCode,
  roomFree,
  wideEvent,
} from "../src/index";

describe("room codes", () => {
  it("are 4 letters from an alphabet without look-alikes (no I, L, O)", () => {
    for (let i = 0; i < 200; i++) expect(newRoomCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  });

  it("use the random source given (deterministic in tests)", () => {
    expect(newRoomCode(() => 0)).toBe("AAAA");
    expect(newRoomCode(() => 0.999)).toBe("ZZZZ");
  });

  it.each([["abcd", "ABCD"], [" ab-cd ", "ABCD"], ["ab", null], ["abcde", null], ["ab1d", null], ["", null]])("parseRoomCode(%j) → %j", (raw, code) => {
    expect(parseRoomCode(raw)).toBe(code);
  });
});

const NOW = 10 * IDLE_MS;
const life = { opened: true, sockets: 0, idleSince: null as number | null, createdAt: NOW - 1000 as number | null, now: NOW };

describe("roomFree: may the front page hand this code to a new TV?", () => {
  it("a code nobody claimed is free", () => {
    expect(roomFree({ ...life, opened: false, createdAt: null })).toBe(true);
  });
  it("a room someone is connected to is never free", () => {
    expect(roomFree({ ...life, sockets: 1, createdAt: 0 })).toBe(false);
  });
  it("a room everyone left more than IDLE_MS ago is free; a moment ago, not", () => {
    expect(roomFree({ ...life, idleSince: NOW - IDLE_MS - 1 })).toBe(true);
    expect(roomFree({ ...life, idleSince: NOW - 1000 })).toBe(false);
  });
  it("a room never connected to is free once IDLE_MS has passed since it was claimed", () => {
    expect(roomFree({ ...life, createdAt: NOW - IDLE_MS - 1 })).toBe(true);
  });
  it("a claimed code a TV hasn't opened yet is taken (two TVs racing)", () => {
    expect(roomFree({ ...life, opened: false, createdAt: NOW - 10 })).toBe(false);
  });
  it("the idle window can be set (a test fixture uses seconds)", () => {
    expect(roomFree({ ...life, idleSince: NOW - 2001 }, 2000)).toBe(true);
  });
});

describe("joinGate: what a phone opening a join link gets", () => {
  const live = { ...life, sockets: 2, member: false, full: false };
  it("missing, ok, ended, full", () => {
    expect(joinGate({ ...live, opened: false })).toBe("missing");
    expect(joinGate(live)).toBe("ok");
    expect(joinGate({ ...live, sockets: 0, idleSince: NOW - IDLE_MS - 1 })).toBe("ended");
    expect(joinGate({ ...live, full: true })).toBe("full");
  });
  it("someone already in the room always gets back in", () => {
    expect(joinGate({ ...live, full: true, member: true })).toBe("ok");
    expect(joinGate({ ...live, sockets: 0, idleSince: NOW - IDLE_MS - 1, member: true })).toBe("ok");
  });
});

describe("parseRef and wideEvent: where a visitor came from, one log line per event", () => {
  it.each([["hn", "hn"], ["HN", "hn"], ["show-hn", "show-hn"], [null, null], ["", null], ["a".repeat(33), null], ["hn<x>", null]])("parseRef(%j) → %j", (raw, ref) => {
    expect(parseRef(raw)).toBe(ref);
  });
  it("names the event and keeps the fields (never names: the caller decides)", () => {
    expect(wideEvent("rocket.round", { room: "ABCD", ref: "hn", players: 2 })).toEqual({ event: "rocket.round", room: "ABCD", ref: "hn", players: 2 });
  });
});

describe("the device: a phone or tablet is a controller, a wide mouse screen is the TV", () => {
  it.each([
    [{ coarse: true, narrow: false }, true],
    [{ coarse: false, narrow: true }, true],
    [{ coarse: false, narrow: false }, false],
  ])("%j → %s", (input, controller) => {
    expect(isControllerDevice(input)).toBe(controller);
  });
});

describe("offerThisComputer: a visitor with no phone (or one) plays on the TV's computer", () => {
  const base = { plainBrowserTv: true, touchTv: false, needsPlayer: true };
  it("offered on a plain browser TV that still needs a player", () => {
    expect(offerThisComputer(base)).toBe(true);
  });
  it.each([
    [{ plainBrowserTv: false }, "the OGS TV or a stream (nobody sits at a Chromecast)"],
    [{ touchTv: true }, "a tablet TV (a second tab would cover it)"],
    [{ needsPlayer: false }, "every seat is taken"],
  ])("not when %j: %s", (patch, _why) => {
    expect(offerThisComputer({ ...base, ...patch })).toBe(false);
  });
});
