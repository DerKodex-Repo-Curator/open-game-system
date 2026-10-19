import { describe, expect, it } from "vitest";
import { OgsProfileSchema, ProfileBridgeStateSchema, ProfileLoginSchema } from "./index";

const profile = {
  id: "p1",
  handle: "juneau",
  name: "Juneau",
  avatar: "https://tv.opengame.org/art/story-nook/char-owl.webp",
  token: "a.b.c",
};

describe("profile login (single-game apps: guest or signed in)", () => {
  it.each(["guest", "apple", "google"])("a ready profile can say how it is signed in: %s", (login) => {
    const s = { status: "ready", profile: { ...profile, login } };
    expect(ProfileBridgeStateSchema.parse(s)).toEqual(s);
  });

  it("is optional: the OGS app's profiles carry none", () => {
    expect(OgsProfileSchema.parse(profile)).toEqual(profile);
    expect(OgsProfileSchema.parse(profile)).not.toHaveProperty("login");
  });

  it("rejects anything else (none is no profile at all)", () => {
    for (const login of ["none", "email", "", 1])
      expect(OgsProfileSchema.safeParse({ ...profile, login }).success).toBe(false);
  });

  it("ProfileLoginSchema lists the three logins", () => {
    expect(ProfileLoginSchema.options).toEqual(["guest", "apple", "google"]);
  });
});
