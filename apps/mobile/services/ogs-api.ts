import {
  type CouchInviteResult,
  CouchInviteResultSchema,
  type FamilyInvite,
  FamilyInviteSchema,
  type Instance,
  type InstanceReport,
  InstanceSchema,
  type Manifest,
  ManifestSchema,
  type RecentPlayer,
  RecentPlayersSchema,
  type ScreenClaimed,
  ScreenClaimedSchema,
} from "@open-game-system/ogs-protocol";
import {
  type Credential,
  createApiRequest,
  type InstanceSource,
  LoginSchema,
  OgsApiError,
  type OgsApiOptions,
  type Profile,
  ProfileSchema,
} from "@open-game-system/shell/modules/api-request";
import { z } from "zod";

/**
 * The OGS API client (services/api, profiles slice 1 contract). Every response is parsed here, at
 * the boundary; screens only ever see typed profiles, manifests, instances and sessions. `fetch`
 * is injected so tests need no server.
 */

// The generic request, error and profile/login schemas live in the shell (shared with every OGS-powered app).
export {
  type Credential,
  createApiRequest,
  type FetchLike,
  type InstanceSource,
  type Login,
  LoginSchema,
  OgsApiError,
  type OgsApiOptions,
  type Profile,
  ProfileSchema,
  type Provider,
} from "@open-game-system/shell/modules/api-request";

export const MeSchema = z.object({ profile: ProfileSchema, logins: z.array(LoginSchema) });
export type Me = z.infer<typeof MeSchema>;

const HandleCheckSchema = z.object({
  handle: z.string(),
  available: z.boolean(),
  suggestion: z.string(),
});
export type HandleCheck = z.infer<typeof HandleCheckSchema>;

const ProfileCreatedSchema = z.object({ profile: ProfileSchema, token: z.string().min(1) });
const SignedInSchema = MeSchema.extend({ token: z.string().min(1) });

export const SessionInfoSchema = z.object({
  sessionId: z.string().min(1),
  code: z.string().min(1),
  tvName: z.string(),
  host: ProfileSchema,
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
const SessionCreatedSchema = SessionInfoSchema.extend({ token: z.string().min(1) });
export type SessionCreated = z.infer<typeof SessionCreatedSchema>;

/** This device, as the API registers it (its id is minted here and becomes the token's `did`). */
export interface DeviceInfo {
  deviceId: string;
  kind: "phone" | "tablet";
  name: string;
}

export interface NewProfile {
  name: string;
  handle?: string;
  sticker: string;
  device: DeviceInfo;
}

export type ProfilePatch = Partial<Pick<Profile, "name" | "handle" | "sticker">>;

const ListSchema = z.array(z.unknown());
const LibrarySchema = z.object({ appIds: z.array(z.string()) });

/** Drop what doesn't parse (one bad manifest must not empty the Library), keep the rest. */
function parseEach<T>(items: unknown[], parse: (x: unknown) => { success: boolean; data?: T }) {
  const out: T[] = [];
  for (const item of items) {
    const r = parse(item);
    if (r.success && r.data !== undefined) out.push(r.data);
    else console.warn("[ogs-api] skipped an item that does not match the protocol");
  }
  return out;
}

const manifests = (items: unknown[]): Manifest[] =>
  parseEach(items, (x) => ManifestSchema.safeParse(x));
const instances = (items: unknown[]): Instance[] =>
  parseEach(items, (x) => InstanceSchema.safeParse(x));

function credentialRequest(c: Credential): { path: string; body: Record<string, string> } {
  switch (c.provider) {
    case "apple":
    case "google":
      return { path: `/api/v1/auth/${c.provider}`, body: { idToken: c.idToken } };
    case "email":
      return { path: "/api/v1/auth/email/verify", body: { email: c.email, code: c.code } };
  }
}

export function createOgsApi(opts: OgsApiOptions) {
  const { request, parse } = createApiRequest(opts);
  const { fetch } = opts;
  return {
    /** The @id a name would get, or whether a typed @id is free (with a free suggestion). */
    async checkHandle(q: { name: string } | { handle: string }): Promise<HandleCheck> {
      const query =
        "name" in q
          ? `name=${encodeURIComponent(q.name)}`
          : `handle=${encodeURIComponent(q.handle)}`;
      return parse(HandleCheckSchema, await request(`/api/v1/handles?${query}`));
    },
    /** Make a profile and this device's token for it (409 handle_taken when the @id is taken). */
    async createProfile(input: NewProfile): Promise<{ profile: Profile; token: string }> {
      const data = await request("/api/v1/profiles", { method: "POST", body: input });
      return parse(ProfileCreatedSchema, data);
    },
    async me(): Promise<Me> {
      return parse(MeSchema, await request("/api/v1/me", { authed: true }));
    },
    async updateMe(patch: ProfilePatch): Promise<Me> {
      const data = await request("/api/v1/me", { method: "PATCH", body: patch, authed: true });
      return parse(MeSchema, data);
    },
    /** Cast: a couch session hosted by this profile, its TV code and the launcher's token. */
    /** Cast: a new couch session; `invite` is the invite another family this household came through. */
    async createSession(tvName: string, invite?: string): Promise<SessionCreated> {
      const data = await request("/api/v1/sessions", {
        method: "POST",
        body: invite ? { tvName, invite } : { tvName },
        authed: true,
      });
      return parse(SessionCreatedSchema, data);
    },
    /** Invite another family to a game: the invite and its link (funnel.invite_sent). */
    async createFamilyInvite(appId: string): Promise<FamilyInvite> {
      const data = await request("/api/v1/family-invites", {
        method: "POST",
        body: { appId },
        authed: true,
      });
      // ogs-protocol's schema (zod 3), so not through parse (this app's zod 4).
      const made = FamilyInviteSchema.safeParse(data);
      if (!made.success) throw new OgsApiError("BAD_RESPONSE", made.error.message, 0);
      return made.data;
    },
    /** Who shared a couch with me in the last 7 days (2026-10-18-second-visit.feature). */
    async recentPlayers(): Promise<RecentPlayer[]> {
      const data = await request("/api/v1/couch/recent-players", { authed: true });
      // ogs-protocol's schema (zod 3), so not through parse (this app's zod 4).
      const got = RecentPlayersSchema.safeParse(data);
      if (!got.success) throw new OgsApiError("BAD_RESPONSE", got.error.message, 0);
      return got.data.players;
    },
    /** Push my couch's join link to them (409 not_casting when my couch isn't on). */
    async inviteToCouch(profileIds: string[]): Promise<CouchInviteResult> {
      const data = await request("/api/v1/couch/invite", {
        method: "POST",
        body: { profileIds },
        authed: true,
      });
      const got = CouchInviteResultSchema.safeParse(data);
      if (!got.success) throw new OgsApiError("BAD_RESPONSE", got.error.message, 0);
      return got.data;
    },
    /** Join a cast with the code the TV shows (404 session_not_found for a wrong code). */
    async joinSession(code: string): Promise<SessionInfo> {
      const data = await request("/api/v1/sessions/join", {
        method: "POST",
        body: { code },
        authed: true,
      });
      return parse(SessionInfoSchema, data);
    },
    /** A browser TV's code typed on this phone: it becomes this phone's TV (404 screen_not_found). */
    async claimScreen(code: string): Promise<ScreenClaimed> {
      const data = await request("/api/v1/screens/claim", {
        method: "POST",
        body: { code },
        authed: true,
      });
      // ogs-protocol's schema (zod 3), so not through parse (this app's zod 4).
      const claimed = ScreenClaimedSchema.safeParse(data);
      if (!claimed.success) throw new OgsApiError("BAD_RESPONSE", claimed.error.message, 0);
      return claimed.data;
    },
    /** Cast to a browser TV: it shows the launcher this token is for. */
    async showOnScreen(screenId: string, token: string): Promise<void> {
      await request(`/api/v1/screens/${encodeURIComponent(screenId)}/show`, {
        method: "POST",
        body: { token },
        authed: true,
      });
    },
    /** Stop casting to a browser TV: it shows its code again. */
    async stopScreen(screenId: string): Promise<void> {
      await request(`/api/v1/screens/${encodeURIComponent(screenId)}/stop`, {
        method: "POST",
        authed: true,
      });
    },
    /** Join a friend's cast from its Join card, without the code (403 not_a_friend). */
    async joinFriendSession(sessionId: string): Promise<SessionInfo> {
      const data = await request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/join`, {
        method: "POST",
        authed: true,
      });
      return parse(SessionInfoSchema, data);
    },
    /** Send a 6-digit sign-in code to an email address. */
    async startEmail(email: string): Promise<void> {
      await request("/api/v1/auth/email/start", { method: "POST", body: { email } });
    },
    /** Back up: link a login to this device's profile (409 login_in_use if another has it). */
    async backUp(credential: Credential): Promise<Me> {
      const { path, body } = credentialRequest(credential);
      return parse(MeSchema, await request(path, { method: "POST", body, authed: true }));
    },
    /** Sign in on this device with a login (404 login_not_found when no profile has it). */
    async signIn(credential: Credential, device: DeviceInfo): Promise<{ me: Me; token: string }> {
      const { path, body } = credentialRequest(credential);
      const data = parse(
        SignedInSchema,
        await request(path, { method: "POST", body: { ...body, device } }),
      );
      return { me: { profile: data.profile, logins: data.logins }, token: data.token };
    },
    async catalogue(): Promise<Manifest[]> {
      return manifests(parse(ListSchema, await request("/api/v1/catalogue")));
    },
    /** The profile's games, as catalogue appIds in its order. */
    async library(): Promise<string[]> {
      return parse(LibrarySchema, await request("/api/v1/me/library", { authed: true })).appIds;
    },
    /** Replace the profile's games (catalogue ids only); returns the saved list. */
    async setLibrary(appIds: string[]): Promise<string[]> {
      const data = await request("/api/v1/me/library", {
        method: "PUT",
        body: { appIds },
        authed: true,
      });
      return parse(LibrarySchema, data).appIds;
    },
    async instances(): Promise<Instance[]> {
      const data = await request("/api/v1/me/instances", { authed: true });
      return instances(parse(ListSchema, data));
    },
    async reportInstance(report: InstanceReport, source: InstanceSource): Promise<Instance> {
      const data = await request("/api/v1/me/instances", {
        method: "POST",
        body: { ...report, source },
        authed: true,
      });
      // InstanceSchema has defaults (input ≠ output type), so it is parsed directly.
      const r = InstanceSchema.safeParse(data);
      if (!r.success) throw new OgsApiError("BAD_RESPONSE", r.error.message, 0);
      return r.data;
    },
    /** Add by link: fetch any OGS game's manifest (parsed with the protocol's ManifestSchema). */
    async fetchManifest(url: string): Promise<Manifest> {
      let res: Response;
      try {
        res = await fetch(url, { headers: { Accept: "application/json" } });
      } catch (err) {
        throw new OgsApiError("OFFLINE", `Can't reach ${url}: ${String(err)}`, 0);
      }
      if (!res.ok)
        throw new OgsApiError(`HTTP_${res.status}`, `${url} answered ${res.status}`, res.status);
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      const r = ManifestSchema.safeParse(json);
      if (!r.success)
        throw new OgsApiError("BAD_MANIFEST", "That link isn't an OGS game manifest", 0);
      return r.data;
    },
  };
}

export type OgsApi = ReturnType<typeof createOgsApi>;
