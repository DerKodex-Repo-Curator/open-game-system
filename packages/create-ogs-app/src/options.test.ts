import { describe, expect, it } from "vitest";
import {
  type Answers,
  AnswersSchema,
  collectAnswers,
  defaultAndroidPackage,
  defaultBundleId,
  defaultLinkDomains,
  defaultName,
  FIELDS,
  parseArgs,
} from "./options";

const rocketCrew: Answers = {
  dir: "app",
  appId: "rocket-crew",
  name: "Rocket Crew",
  gameUrl: "https://rocketcrew.tv/phone",
  bundleId: "tv.rocketcrew.app",
  androidPackage: "tv.rocketcrew.app",
  teamId: "34S957HD77",
  linkDomains: ["rocketcrew.tv"],
  branding: "hidden",
  shellVersion: "^0.1.0",
};

const allFlags = [
  "app",
  "--app-id",
  "rocket-crew",
  "--name",
  "Rocket Crew",
  "--game-url",
  "https://rocketcrew.tv/phone",
  "--bundle-id",
  "tv.rocketcrew.app",
  "--package",
  "tv.rocketcrew.app",
  "--team-id",
  "34S957HD77",
  "--link-domain",
  "rocketcrew.tv",
  "--branding",
  "hidden",
];

describe("parseArgs", () => {
  it("reads the directory and every flag", () => {
    const parsed = parseArgs(allFlags);
    expect(parsed).toEqual({
      ok: true,
      args: {
        dir: "app",
        appId: "rocket-crew",
        name: "Rocket Crew",
        gameUrl: "https://rocketcrew.tv/phone",
        bundleId: "tv.rocketcrew.app",
        androidPackage: "tv.rocketcrew.app",
        teamId: "34S957HD77",
        linkDomains: ["rocketcrew.tv"],
        branding: "hidden",
        yes: false,
        help: false,
      },
    });
  });

  it("takes --link-domain more than once, and comma-separated", () => {
    const parsed = parseArgs(["--link-domain", "a.tv,b.tv", "--link-domain", "c.tv"]);
    expect(parsed.ok && parsed.args.linkDomains).toEqual(["a.tv", "b.tv", "c.tv"]);
  });

  it("--no-link-domain means none (only opengame.org/play/<appId>)", () => {
    const parsed = parseArgs(["--no-link-domain"]);
    expect(parsed.ok && parsed.args.linkDomains).toEqual([]);
  });

  it("leaves out what wasn't given", () => {
    expect(parseArgs([])).toEqual({ ok: true, args: { yes: false, help: false } });
  });

  it("reads -y, --yes, -h, --help and --shell-version", () => {
    const parsed = parseArgs(["-y", "-h", "--shell-version", "link:../shell"]);
    expect(parsed).toEqual({
      ok: true,
      args: { yes: true, help: true, shellVersion: "link:../shell" },
    });
    expect(parseArgs(["--yes", "--help"])).toEqual({ ok: true, args: { yes: true, help: true } });
  });

  it("refuses unknown flags and a second directory", () => {
    const unknown = parseArgs(["--bundle", "x"]);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.error).toMatch(/--bundle/);
    const two = parseArgs(["a", "b"]);
    expect(two.ok).toBe(false);
    expect(!two.ok && two.error).toMatch(/one directory/);
  });
});

describe("AnswersSchema", () => {
  it("accepts Rocket Crew", () => {
    expect(AnswersSchema.parse(rocketCrew)).toEqual(rocketCrew);
  });

  it.each([
    ["appId", "Rocket Crew"],
    ["appId", "-rocket"],
    ["appId", ""],
    ["name", ""],
    ["name", 'Rocket "Crew"'],
    ["name", "A name far too long for the home screen"],
    ["gameUrl", "http://rocketcrew.tv/phone"],
    ["gameUrl", "rocketcrew.tv"],
    ["bundleId", "rocketcrew"],
    ["bundleId", "tv.rocket crew"],
    ["androidPackage", "tv.rocket-crew.app"],
    ["androidPackage", "tv.1rocket.app"],
    ["teamId", "34s957hd77"],
    ["teamId", "ABC"],
    ["branding", "loud"],
    ["dir", ""],
  ])("refuses %s = %j", (key, value) => {
    expect(AnswersSchema.safeParse({ ...rocketCrew, [key]: value }).success).toBe(false);
  });

  it.each([
    ["https://rocketcrew.tv"],
    ["rocketcrew.tv/phone"],
    ["opengame.org"],
    ["Rocket Crew.tv"],
    ["localhost"],
  ])("refuses link domain %j", (domain) => {
    expect(AnswersSchema.safeParse({ ...rocketCrew, linkDomains: [domain] }).success).toBe(false);
  });

  it("lower-cases link domains and drops repeats", () => {
    const parsed = AnswersSchema.parse({
      ...rocketCrew,
      linkDomains: ["RocketCrew.tv", "rocketcrew.tv", "play.rocketcrew.tv"],
    });
    expect(parsed.linkDomains).toEqual(["rocketcrew.tv", "play.rocketcrew.tv"]);
  });

  it("defaults branding to hidden and trims the name", () => {
    const { branding: _b, ...rest } = rocketCrew;
    const parsed = AnswersSchema.parse({ ...rest, name: "  Rocket Crew " });
    expect(parsed.branding).toBe("hidden");
    expect(parsed.name).toBe("Rocket Crew");
  });

  it("allows powered-by branding", () => {
    expect(AnswersSchema.parse({ ...rocketCrew, branding: "powered-by" }).branding).toBe(
      "powered-by",
    );
  });
});

describe("defaults", () => {
  it("name from the app id", () => {
    expect(defaultName("rocket-crew")).toBe("Rocket Crew");
    expect(defaultName("codebreakers")).toBe("Codebreakers");
  });

  it("bundle id from the game's own domain", () => {
    expect(defaultBundleId("https://rocketcrew.tv/phone")).toBe("tv.rocketcrew.app");
    expect(defaultBundleId("https://www.codebreakers.example/")).toBe("example.codebreakers.app");
  });

  it("no bundle id from a shared host or a bad URL", () => {
    expect(defaultBundleId("https://rocket-crew.pages.dev/phone")).toBeUndefined();
    expect(defaultBundleId("https://rocket.vercel.app")).toBeUndefined();
    expect(defaultBundleId("https://jon.github.io/rocket")).toBeUndefined();
    expect(defaultBundleId("https://rocket.jon.workers.dev")).toBeUndefined();
    expect(defaultBundleId("not a url")).toBeUndefined();
  });

  it("Android package from the bundle id when it is a valid one", () => {
    expect(defaultAndroidPackage("tv.rocketcrew.app")).toBe("tv.rocketcrew.app");
    expect(defaultAndroidPackage("tv.rocket-crew.App")).toBe("tv.rocket_crew.app");
    expect(defaultAndroidPackage("tv.1up.app")).toBeUndefined();
  });

  it("link domain: the game's own domain, never a shared host", () => {
    expect(defaultLinkDomains("https://rocketcrew.tv/phone")).toEqual(["rocketcrew.tv"]);
    expect(defaultLinkDomains("https://www.rocketcrew.tv/phone")).toEqual(["www.rocketcrew.tv"]);
    expect(defaultLinkDomains("https://rocket.pages.dev")).toEqual([]);
    expect(defaultLinkDomains("nope")).toEqual([]);
  });
});

/** A fake prompt: answers from a queue, records the questions and defaults it was asked. */
function fakeAsk(replies: string[]) {
  const asked: { question: string; fallback: string | undefined }[] = [];
  const ask = async (question: string, fallback?: string) => {
    asked.push({ question, fallback });
    return replies.shift() ?? "";
  };
  return { ask, asked };
}

describe("collectAnswers", () => {
  it("asks nothing when every flag is given", async () => {
    const parsed = parseArgs([...allFlags, "--shell-version", "^0.1.0"]);
    if (!parsed.ok) throw new Error(parsed.error);
    const { ask, asked } = fakeAsk([]);
    const result = await collectAnswers(parsed.args, { ask });
    expect(result).toEqual({ ok: true, answers: rocketCrew });
    expect(asked).toEqual([]);
  });

  it("asks for what is missing, offering defaults (empty reply takes the default)", async () => {
    const { ask, asked } = fakeAsk([
      "app", // dir
      "rocket-crew",
      "", // name → Rocket Crew
      "https://rocketcrew.tv/phone",
      "", // bundle id → tv.rocketcrew.app
      "", // package → tv.rocketcrew.app
      "34S957HD77",
      "", // link domains → rocketcrew.tv
      "", // branding → hidden
    ]);
    const result = await collectAnswers({ yes: false, help: false }, { ask });
    expect(result).toEqual({ ok: true, answers: rocketCrew });
    expect(asked.map((a) => a.fallback)).toEqual([
      "app",
      undefined,
      "Rocket Crew",
      undefined,
      "tv.rocketcrew.app",
      "tv.rocketcrew.app",
      undefined,
      "rocketcrew.tv",
      "hidden",
    ]);
    expect(asked).toHaveLength(FIELDS.length);
  });

  it("asks again after an answer that isn't valid, saying why", async () => {
    const { ask, asked } = fakeAsk(["34s", "34S957HD77"]);
    const { teamId: _t, ...given } = rocketCrew;
    const result = await collectAnswers(
      { ...given, yes: false, help: false },
      { ask, warn: (m) => asked.push({ question: `warn: ${m}`, fallback: undefined }) },
    );
    expect(result.ok && result.answers.teamId).toBe("34S957HD77");
    expect(asked.map((a) => a.question)).toEqual([
      expect.stringMatching(/team id/i),
      expect.stringMatching(/^warn: .*10/),
      expect.stringMatching(/team id/i),
    ]);
  });

  it("'-' for link domains means none", async () => {
    const { ask } = fakeAsk(["-"]);
    const { linkDomains: _l, ...given } = rocketCrew;
    const result = await collectAnswers({ ...given, yes: false, help: false }, { ask });
    expect(result.ok && result.answers.linkDomains).toEqual([]);
  });

  it("with --yes, takes the defaults and never asks", async () => {
    const { ask, asked } = fakeAsk([]);
    const result = await collectAnswers(
      {
        appId: "rocket-crew",
        gameUrl: "https://rocketcrew.tv/phone",
        teamId: "34S957HD77",
        yes: true,
        help: false,
      },
      { ask },
    );
    expect(result).toEqual({ ok: true, answers: rocketCrew });
    expect(asked).toEqual([]);
  });

  it("with --yes, names every flag that has no default", async () => {
    const { ask } = fakeAsk([]);
    const result = await collectAnswers(
      { gameUrl: "https://rocket.pages.dev/phone", yes: true, help: false },
      { ask },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/--app-id/);
    expect(!result.ok && result.error).toMatch(/--team-id/);
    expect(!result.ok && result.error).toMatch(/--bundle-id/);
    expect(!result.ok && result.error).not.toMatch(/--name/);
  });

  it("with --yes, a bad flag is an error (not a question)", async () => {
    const { ask, asked } = fakeAsk([]);
    const result = await collectAnswers(
      { ...rocketCrew, teamId: "nope", yes: true, help: false },
      { ask },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/--team-id/);
    expect(asked).toEqual([]);
  });

  it("without --yes, a bad flag is asked again", async () => {
    const { ask, asked } = fakeAsk(["34S957HD77"]);
    const result = await collectAnswers(
      { ...rocketCrew, teamId: "nope", yes: false, help: false },
      { ask },
    );
    expect(result.ok && result.answers.teamId).toBe("34S957HD77");
    expect(asked).toHaveLength(1);
  });
});

describe("AnswersSchema, to the letter", () => {
  it.each([
    ["appId", "rocket-crew!"],
    ["appId", "rocket--crew"],
    ["name", '"Rocket'],
    ["name", "Rocket\nCrew"],
    ["bundleId", ".tv.rocketcrew"],
    ["bundleId", "tv.rocketcrew!"],
    ["androidPackage", "tv.r-c.app"],
    ["androidPackage", "_tv.rocketcrew"],
    ["teamId", "X34S957HD77"],
    ["teamId", "34S957HD77X"],
  ])("refuses %s = %j", (key, value) => {
    expect(AnswersSchema.safeParse({ ...rocketCrew, [key]: value }).success).toBe(false);
  });

  it.each([
    ["a-.tv"],
    ["-a.tv"],
    [`${"a".repeat(250)}.tv`],
    ["play.opengame.org"],
    ["rocketcrew.tv/"],
  ])("refuses link domain %j", (domain) => {
    expect(AnswersSchema.safeParse({ ...rocketCrew, linkDomains: [domain] }).success).toBe(false);
  });

  it("accepts a one-letter label and the longest names", () => {
    expect(AnswersSchema.safeParse({ ...rocketCrew, linkDomains: ["a.tv"] }).success).toBe(true);
    expect(AnswersSchema.safeParse({ ...rocketCrew, name: "R".repeat(30) }).success).toBe(true);
    expect(AnswersSchema.safeParse({ ...rocketCrew, appId: "a".repeat(40) }).success).toBe(true);
    expect(AnswersSchema.safeParse({ ...rocketCrew, appId: "a".repeat(41) }).success).toBe(false);
  });

  it("trims every answer", () => {
    const padded = Object.fromEntries(
      Object.entries(rocketCrew).map(([k, v]) => [k, typeof v === "string" ? ` ${v} ` : v]),
    );
    expect(AnswersSchema.parse({ ...padded, linkDomains: [" RocketCrew.tv "] })).toEqual(
      rocketCrew,
    );
  });

  it.each([
    ["dir", "", "the directory can't be empty"],
    ["appId", "X", "must be your OGS catalogue id, like rocket-crew"],
    ["name", "", "the app needs a name"],
    ["name", "N".repeat(31), "App Store names are at most 30 characters"],
    ["name", "`", "no quotes, backslashes or backticks"],
    ["gameUrl", "http://x.tv", "must be an https:// URL (the game's phone page)"],
    ["bundleId", "x", "must be reverse-DNS, like tv.rocketcrew.app"],
    [
      "androidPackage",
      "x",
      "must be like tv.rocketcrew.app (letters, digits and _; each part starts with a letter)",
    ],
    ["teamId", "x", "must be 10 characters (A-Z, 0-9), like 34S957HD77"],
  ])("says why %s %j is wrong", (key, value, message) => {
    const parsed = AnswersSchema.safeParse({ ...rocketCrew, [key]: value });
    expect(parsed.error?.issues[0]?.message).toBe(message);
  });

  it("says why a link domain is wrong", () => {
    const messages = (domain: string) =>
      AnswersSchema.safeParse({ ...rocketCrew, linkDomains: [domain] }).error?.issues.map(
        (i) => i.message,
      );
    expect(messages("https://x.tv")).toEqual([
      "must be a bare domain like rocketcrew.tv (no https://, no path)",
    ]);
    expect(messages("opengame.org")).toEqual([
      "opengame.org/play/<appId> is always on; list only your own domains",
    ]);
  });
});

describe("parseArgs, exactly", () => {
  it("sets nothing it wasn't given (not even undefined keys)", () => {
    const parsed = parseArgs(["--app-id", "x"]);
    expect(parsed).toStrictEqual({ ok: true, args: { yes: false, help: false, appId: "x" } });
  });

  it("drops blanks and spaces from link domain lists", () => {
    const parsed = parseArgs(["--link-domain", " a.tv , ,b.tv,"]);
    expect(parsed.ok && parsed.args.linkDomains).toEqual(["a.tv", "b.tv"]);
  });

  it("says how many directories it got", () => {
    expect(parseArgs(["a", "b"])).toEqual({ ok: false, error: "give one directory, not 2: a b" });
  });
});

describe("defaults, exactly", () => {
  it.each([
    "pages.dev",
    "workers.dev",
    "vercel.app",
    "netlify.app",
    "github.io",
    "web.app",
    "firebaseapp.com",
    "onrender.com",
    "fly.dev",
    "herokuapp.com",
    "itch.io",
  ])("no domain defaults on %s", (host) => {
    expect(defaultBundleId(`https://game.${host}/`)).toBeUndefined();
    expect(defaultBundleId(`https://${host}/`)).toBeUndefined();
    expect(defaultLinkDomains(`https://game.${host}/`)).toEqual([]);
  });

  it("a host that only ends like a shared host is the game's own", () => {
    expect(defaultBundleId("https://mypages.dev/")).toBe("dev.mypages.app");
  });

  it("no defaults from an IP address or localhost", () => {
    expect(defaultBundleId("https://localhost:5173/")).toBeUndefined();
    expect(defaultBundleId("https://192.168.0.10/")).toBeUndefined();
  });

  it("only a leading www. is dropped", () => {
    expect(defaultBundleId("https://play.www.example.com/")).toBe("com.example.www.play.app");
  });

  it("names skip empty words", () => {
    expect(defaultName("rocket--crew-")).toBe("Rocket Crew");
  });
});

describe("collectAnswers, exactly", () => {
  it("a reply of spaces takes the default", async () => {
    const { ask } = fakeAsk(["   "]);
    const { name: _n, ...given } = rocketCrew;
    const result = await collectAnswers({ ...given, yes: false, help: false }, { ask });
    expect(result.ok && result.answers.name).toBe("Rocket Crew");
  });

  it("warns with the question's label and the reason", async () => {
    const warnings: string[] = [];
    const { ask } = fakeAsk(["nope", "34S957HD77"]);
    const { teamId: _t, ...given } = rocketCrew;
    await collectAnswers(
      { ...given, yes: false, help: false },
      { ask, warn: (m) => warnings.push(m) },
    );
    expect(warnings).toEqual(["Apple Team ID must be 10 characters (A-Z, 0-9), like 34S957HD77"]);
  });

  it("works without a warn function", async () => {
    const { ask } = fakeAsk(["nope", "34S957HD77"]);
    const { teamId: _t, ...given } = rocketCrew;
    const result = await collectAnswers({ ...given, yes: false, help: false }, { ask });
    expect(result.ok).toBe(true);
  });

  it("with --yes, lists what is missing first, then what is wrong, one per line", async () => {
    const { ask } = fakeAsk([]);
    const result = await collectAnswers(
      { gameUrl: "https://rocketcrew.tv/phone", teamId: "nope", yes: true, help: false },
      { ask },
    );
    expect(result).toEqual({
      ok: false,
      error: "--yes needs --app-id\n--team-id must be 10 characters (A-Z, 0-9), like 34S957HD77",
    });
  });

  it("with --yes, a bad default from a good earlier answer is still taken as asked", async () => {
    const { ask } = fakeAsk([]);
    const result = await collectAnswers(
      {
        appId: "rocket-crew",
        gameUrl: "https://rocketcrew.tv/phone",
        teamId: "34S957HD77",
        bundleId: "tv.1up.app",
        yes: true,
        help: false,
      },
      { ask },
    );
    expect(result).toEqual({ ok: false, error: "--yes needs --package" });
  });

  it("asks with each field's own question", async () => {
    const { ask, asked } = fakeAsk([
      "app",
      "rocket-crew",
      "",
      "https://rocketcrew.tv/phone",
      "",
      "",
      "34S957HD77",
      "",
      "",
    ]);
    await collectAnswers({ yes: false, help: false }, { ask });
    expect(asked.map((a) => a.question)).toEqual(FIELDS.map((f) => f.question));
    expect(FIELDS.map((f) => f.question.split(" (")[0])).toEqual([
      "Directory for the app",
      "OGS app id",
      "App name",
      "Game URL",
      "iOS bundle id",
      "Android package",
      "Apple Team ID",
      "Your link domains",
      "Branding: hidden, or powered-by",
    ]);
  });
});
