import { z } from "zod";

/** What a page sends to its room over the WebSocket. Parsed at the boundary, in the Room. */
const Unit = z.number().min(-1).max(1);
export const ClientMessageSchema = z.discriminatedUnion("type", [
  /** The TV page says it is the room's screen. */
  z.object({ type: z.literal("screen") }),
  /** A phone takes a seat: with an OGS game token (inside the OGS app) or a typed name. */
  z.object({
    type: z.literal("join"),
    playerId: z.string().min(1).max(64),
    name: z.string().max(40).optional(),
    ogsToken: z.string().min(1).optional(),
  }),
  /** A phone's stick, -1..1 on each axis. */
  z.object({ type: z.literal("stick"), x: Unit, y: Unit }),
  /** The TV's scoreboard, relayed to the phones. */
  z.object({
    type: z.literal("scores"),
    round: z.number().int().positive(),
    phase: z.enum(["play", "over"]),
    scores: z.record(z.string(), z.number().int().nonnegative()),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const SeatSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  avatar: z.string().url().optional(),
});

/** What the room sends to its pages. Parsed at the boundary, in each page. */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), you: SeatSchema }),
  z.object({ type: z.literal("seats"), seats: z.array(SeatSchema) }),
  z.object({ type: z.literal("stick"), id: z.string(), x: Unit, y: Unit }),
  z.object({
    type: z.literal("scores"),
    round: z.number(),
    phase: z.enum(["play", "over"]),
    scores: z.record(z.string(), z.number()),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** POST /api/rooms answers this. */
export const CreatedRoomSchema = z.object({ code: z.string() });
