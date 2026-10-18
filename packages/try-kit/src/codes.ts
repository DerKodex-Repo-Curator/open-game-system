/** Room codes: 4 letters, no look-alikes (no I, L, O): 23^4 ≈ 280k codes. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

export function newRoomCode(rand: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => ALPHABET[Math.min(ALPHABET.length - 1, Math.floor(rand() * ALPHABET.length))]).join("");
}

/** What someone typed, as a code (any case; spaces and dashes ignored), else null. */
export function parseRoomCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return ROOM_CODE.test(code) ? code : null;
}
