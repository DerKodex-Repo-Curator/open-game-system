// This device's identity (schema + secure storage) lives in the shell; the stickers are the OGS app's.
export * from "@open-game-system/shell/modules/identity";

/** The Story Nook characters people pick as their sticker (no initials anywhere). */
export const STICKERS = [
  { id: "bear", label: "Bear" },
  { id: "owl", label: "Owl" },
  { id: "dragon", label: "Dragon" },
  { id: "dinosaur", label: "Dinosaur" },
  { id: "turtle", label: "Turtle" },
  { id: "whale", label: "Whale" },
  { id: "firefly", label: "Firefly" },
  { id: "mouse", label: "Mouse" },
  { id: "cloud", label: "Cloud" },
] as const;
export type StickerId = (typeof STICKERS)[number]["id"];
