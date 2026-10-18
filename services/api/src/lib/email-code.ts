/** Email sign-in: a 6-digit code, good for 10 minutes and 5 tries, stored only as a hash. */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

export function newEmailCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

export async function hashCode(email: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${email}:${code}`),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface StoredCode {
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

export type CodeCheck = "ok" | "wrong" | "expired" | "burned";

/** Judges a typed code against what was sent. "wrong" counts as an attempt; the others end it. */
export function checkCode(stored: StoredCode, typedHash: string, now: number): CodeCheck {
  if (stored.attempts >= MAX_ATTEMPTS) return "burned";
  if (now >= stored.expiresAt) return "expired";
  return stored.codeHash === typedHash ? "ok" : "wrong";
}

/** The message: the code, and a link that carries it to the app. */
export function codeEmail(code: string) {
  const link = `https://opengame.org/signin?code=${code}`;
  return {
    subject: `${code} is your OGS code`,
    text: `Your OGS code is ${code}. It works for 10 minutes.\n\nOr open this link on your phone: ${link}\n\nIf you didn't ask for this, ignore this email.`,
    html: `<p>Your OGS code is</p><p style="font-size:28px;font-weight:800;letter-spacing:4px">${code}</p><p>It works for 10 minutes. Or <a href="${link}">open OGS</a> on your phone.</p><p>If you didn't ask for this, ignore this email.</p>`,
  };
}
