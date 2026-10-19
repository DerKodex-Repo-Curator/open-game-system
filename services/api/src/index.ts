import { Hono } from "hono";
import { cors } from "hono/cors";
import { anyToken } from "./middleware/profile-auth";
import { onError, wideEvent } from "./middleware/wide-event";
import appDevices from "./routes/app-devices";
import appRelease from "./routes/app-release";
import apps from "./routes/apps";
import auth from "./routes/auth";
import catalogue from "./routes/catalogue";
import catalogueEntries from "./routes/catalogue-entries";
import clientEvents from "./routes/client-events";
import couch from "./routes/couch";
import couchInvites from "./routes/couch-invites";
import deliver from "./routes/deliver";
import dev from "./routes/dev";
import devices from "./routes/devices";
import familyInvites from "./routes/family-invites";
import friends from "./routes/friends";
import games from "./routes/games";
import instances from "./routes/instances";
import join from "./routes/join";
import library from "./routes/library";
import me from "./routes/me";
import profiles from "./routes/profiles";
import push from "./routes/push";
import pushSettings from "./routes/push-settings";
import screens from "./routes/screens";
import sessions from "./routes/sessions";
import stream from "./routes/stream";
import wellKnown from "./routes/well-known";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// One wide event per request (docs/agents/observability.md); unhandled errors answer the contract.
app.use("*", wideEvent);
app.onError(onError);

// Global CORS
app.use("*", cors());

// Health check
app.get("/api/v1/health", (c) => {
  return c.json({ status: "ok" });
});

// Device registration (no API key required - called by the OGS app)
app.route("/api/v1/devices", devices);
// White-label apps: registration, push credentials (game API key), app links (public).
app.route("/api/v1/apps", apps);
app.route("/api/v1/apps", appDevices);
// Developer API, deliver (ogs try, ogs push send): game key; before /games, whose routes need a profile token
app.route("/api/v1", deliver);

// Profiles (docs/product-specs/ogs-profiles.html): POST /profiles, GET /handles (no token)
app.route("/api/v1", profiles);

// The signed-in profile: profile JWTs, see middleware/profile-auth.ts
app.use("/api/v1/me", anyToken);
app.use("/api/v1/me/*", anyToken);
app.route("/api/v1/me", me);
app.route("/api/v1/me", library);
app.route("/api/v1/me", instances);
app.route("/api/v1/me", pushSettings);

// Back up and sign in (Apple, Google, email code)
app.route("/api/v1/auth", auth);

// Couch sessions: one per cast, joined with the TV code
app.route("/api/v1/sessions", sessions);
// The join page's look at a couch by its TV code (no token)
app.route("/api/v1/join", join);
// Invite another family: the game link with an invite id, and the funnel events
app.route("/api/v1/family-invites", familyInvites);
app.route("/api/v1/couch", couchInvites);
// Browser screens: a browser on the TV, paired with a code (no Chromecast)
app.route("/api/v1/screens", screens);

// Friends (slice 2): invites, requests, the list with presence, friends' casts
app.route("/api/v1/friends", friends);

// Games know who you are (slice 3): game tokens and OGS's public key
// Game pushes first: sends use the game's API key, not the profile token the games router demands
app.route("/api/v1/games", push);
app.route("/api/v1/games", games);
app.route("/.well-known", wellKnown);

// Couch session WebSocket (profile or launcher token in ?token=, session in ?session=)
app.route("/api/v1/couch", couch);

// Catalogue of games (public)
app.route("/api/v1/catalogue", catalogue);
// The catalogue's developer API: manifests/check (public), catalogue-entry (game key), admin review
app.route("/api/v1", catalogueEntries);

// Client wide events (app: profile token; cast receiver: none) → Workers Logs
app.route("/api/v1/client-events", clientEvents);

// Beta releases: the app reads the latest build per platform; CI records it (RELEASE_TOKEN)
app.route("/api/v1/app-release", appRelease);

// The developer tool (ogs init): where the docs and the kits are (public)
app.route("/api/v1/dev", dev);

// Stream routes (no API key required - called by web games directly)
app.route("/api/v1/stream", stream);

export default app;

// Durable Object export — Cloudflare requires DO classes exported from the entry point.
export { CouchSession } from "./couch-session";
