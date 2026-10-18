/**
 * vercel-labs/emulate on fixed test ports: real OIDC (RS256 ID tokens + JWKS) for Apple and Google.
 * Started by global-setup.ts; the Worker's env points at these.
 */
export const EMULATED = {
  google: "http://localhost:4202",
  apple: "http://localhost:4204",
} as const;

export const TEST_CLIENTS = {
  apple: "org.opengame.app",
  google: "ogs-test.apps.googleusercontent.com",
};

/** Seeded in both Apple and Google; each test uses its own so logins don't collide. */
export const PEOPLE = [
  "jonathan@example.com",
  "mom@example.com",
  "juneau@example.com",
  "nana@example.com",
  "max@example.com",
  "kim@example.com",
  "lee@example.com",
  "sam@example.com",
] as const;
