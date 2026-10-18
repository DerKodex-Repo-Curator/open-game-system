import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "./protocol";
import { leave, MAX_SEATS, newRoomCode, seatFor } from "./room-core";

describe("seating a player", () => {
  it("seats an OGS player under their verified OGS name, never the name they typed", () => {
    const r = seatFor(
      [],
      { playerId: "p1", name: "typed" },
      { sub: "u1", name: "Sam", avatar: "https://x/a.png" },
    );
    expect(r).toEqual({
      ok: true,
      seat: { id: "ogs:u1", name: "Sam", avatar: "https://x/a.png", color: expect.any(String) },
      seats: [expect.objectContaining({ id: "ogs:u1" })],
    });
  });

  it("seats a plain-browser guest under the name from the form", () => {
    const r = seatFor([], { playerId: "p1", name: "  Ada " }, null);
    expect(r.ok && r.seat).toMatchObject({ id: "guest:p1", name: "Ada" });
  });

  it("refuses a guest with no name (a bad or missing token is not a seat)", () => {
    expect(seatFor([], { playerId: "p1" }, null)).toEqual({ ok: false, error: "name required" });
  });

  it("keeps one seat per player across reconnects, and a colour per seat", () => {
    const one = seatFor([], { playerId: "p1", name: "Ada" }, null);
    if (!one.ok) throw new Error("not seated");
    const again = seatFor(one.seats, { playerId: "p1", name: "Ada" }, null);
    expect(again.ok && again.seats).toHaveLength(1);
    const two = seatFor(one.seats, { playerId: "p2", name: "Bo" }, null);
    if (!two.ok) throw new Error("not seated");
    expect(two.seats[0]?.color).not.toBe(two.seats[1]?.color);
  });

  it("fills up at the seat limit", () => {
    let seats: ReturnType<typeof leave> = [];
    for (let i = 0; i < MAX_SEATS; i++) {
      const r = seatFor(seats, { playerId: `p${i}`, name: `P${i}` }, null);
      if (r.ok) seats = r.seats;
    }
    expect(seatFor(seats, { playerId: "late", name: "Late" }, null)).toEqual({
      ok: false,
      error: "room full",
    });
  });

  it("frees a seat when its player leaves", () => {
    const r = seatFor([], { playerId: "p1", name: "Ada" }, null);
    if (!r.ok) throw new Error("not seated");
    expect(leave(r.seats, "guest:p1")).toEqual([]);
  });
});

describe("room codes", () => {
  it("are 4 letters that read unambiguously on a TV", () => {
    for (let i = 0; i < 50; i++) expect(newRoomCode()).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });
});

describe("messages from clients", () => {
  it("clamps nothing silently: a stick outside -1..1 is rejected", () => {
    expect(ClientMessageSchema.safeParse({ type: "stick", x: 2, y: 0 }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "stick", x: 0.5, y: -1 }).success).toBe(true);
  });
  it("rejects unknown messages", () => {
    expect(ClientMessageSchema.safeParse({ type: "cheat" }).success).toBe(false);
  });
});
