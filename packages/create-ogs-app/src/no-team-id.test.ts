import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type CliIO, main } from "./cli";
import { nextSteps } from "./next-steps";
import { type Answers, collectAnswers, FIELDS } from "./options";
import { findPlaceholders } from "./placeholders";

/**
 * A developer without an Apple Developer account yet can still make the app and run it in the
 * iOS Simulator: the Team ID is only for a real phone and the stores.
 */

const rocketCrew: Answers = {
  dir: "app",
  appId: "rocket-crew",
  name: "Rocket Crew",
  gameUrl: "https://rocketcrew.tv/phone",
  bundleId: "tv.rocketcrew.app",
  androidPackage: "tv.rocketcrew.app",
  teamId: "",
  linkDomains: ["rocketcrew.tv"],
  branding: "hidden",
  shellVersion: "^0.1.0",
};

const { teamId: _t, ...withoutTeam } = rocketCrew;

describe("the Team ID can wait", () => {
  it("an empty reply skips it", async () => {
    const result = await collectAnswers(
      { ...withoutTeam, yes: false, help: false },
      { ask: async () => "" },
    );
    expect(result).toEqual({ ok: true, answers: rocketCrew });
  });

  it("'-' skips it, as for link domains", async () => {
    const result = await collectAnswers(
      { ...withoutTeam, yes: false, help: false },
      { ask: async () => "-" },
    );
    expect(result.ok && result.answers.teamId).toBe("");
  });

  it("--team-id - with --yes skips it", async () => {
    const result = await collectAnswers(
      { ...withoutTeam, teamId: "-", yes: true, help: false },
      { ask: async () => "" },
    );
    expect(result).toEqual({ ok: true, answers: rocketCrew });
  });

  it("the question says the simulator doesn't need one", () => {
    const question = FIELDS.find((f) => f.key === "teamId")?.question ?? "";
    expect(question).toMatch(/^Apple Team ID \(/);
    expect(question).toMatch(/Enter to skip/);
    expect(question).toMatch(/simulator/i);
  });

  it("a bad one is still refused", async () => {
    const replies = ["34s", "34S957HD77"];
    const warnings: string[] = [];
    const result = await collectAnswers(
      { ...withoutTeam, yes: false, help: false },
      { ask: async () => replies.shift() ?? "", warn: (m) => warnings.push(m) },
    );
    expect(result.ok && result.answers.teamId).toBe("34S957HD77");
    expect(warnings).toHaveLength(1);
  });
});

describe("an app made without a Team ID", () => {
  async function make(flags: string[]) {
    const cwd = mkdtempSync(join(tmpdir(), "create-ogs-app-noteam-"));
    const out: string[] = [];
    const io: CliIO = { cwd, ask: async () => "", log: (m) => out.push(m), error: () => {} };
    const code = await main(
      [
        "app",
        "--app-id",
        "rocket-crew",
        "--game-url",
        "https://rocketcrew.tv/phone",
        "--team-id",
        "-",
        ...flags,
        "--yes",
      ],
      io,
    );
    const read = (f: string) => readFileSync(join(cwd, "app", f), "utf8");
    return { code, read, out: out.join("\n") };
  }

  it("leaves appleTeamId empty in app.config.ts (Expo skips an empty one) and says where it goes", async () => {
    const { code, read } = await make([]);
    expect(code).toBe(0);
    const config = read("app.config.ts");
    expect(config).toContain('appleTeamId: "",');
    expect(config).toMatch(/simulator doesn't need/);
  });

  it("eas.json has no empty appleTeamId and is still JSON", async () => {
    const { read } = await make([]);
    const text = read("eas.json");
    expect(text).not.toContain("appleTeamId");
    const eas = z
      .object({ submit: z.object({ preview: z.object({}), production: z.object({}) }) })
      .safeParse(JSON.parse(text));
    expect(eas.success).toBe(true);
  });

  it("text files show a <TEAM_ID> blank, not an empty flag", async () => {
    const { read } = await make([]);
    const readme = read("README.md");
    expect(readme).toContain("--team-id <TEAM_ID>");
    expect(readme).not.toMatch(/--team-id\s*\n/);
    const aasa = read("link-files/.well-known/apple-app-site-association");
    expect(aasa).toContain('"<TEAM_ID>.tv.rocketcrew.app"');
    expect(findPlaceholders(readme)).toEqual([]);
  });

  it("the printed next steps say the simulator needs no accounts and where the Team ID goes", async () => {
    const { out } = await make([]);
    expect(out).toContain("--team-id <TEAM_ID>");
    expect(out).not.toMatch(/--team-id\s*\n/);
    expect(out).toMatch(/simulator needs no Apple account/);
    expect(out).toContain("ios.appleTeamId");
  });
});

describe("nextSteps without a Team ID", () => {
  it("puts the Team ID note right after the simulator commands", () => {
    const text = nextSteps(rocketCrew, "app");
    const run = text.indexOf("pnpm ios");
    const note = text.indexOf("simulator needs no Apple account");
    const login = text.indexOf("ogs login");
    expect(run).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(run);
    expect(login).toBeGreaterThan(note);
  });

  it("says nothing about it when the Team ID is there", () => {
    expect(nextSteps({ ...rocketCrew, teamId: "34S957HD77" }, "app")).not.toContain(
      "simulator needs no Apple account",
    );
  });
});
