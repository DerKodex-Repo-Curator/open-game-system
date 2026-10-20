import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { type CliIO, main } from "./cli";
import { generateApp, TargetNotEmptyError } from "./generate";
import { InputEndedError } from "./line-prompt";
import { nextSteps } from "./next-steps";
import { type Answers, AnswersSchema, type Args, collectAnswers } from "./options";
import { placeholderValues, renderTemplate } from "./placeholders";
import { drawAsset } from "./png";
import { withoutEmptyTeamIds } from "./team-id";

// Edges the other suites leave open (found by mutation testing): exact messages, error names,
// the exact ring the placeholder art draws.

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
const flags: { yes: boolean; help: boolean } = { yes: true, help: false };
const tmp = () => mkdtempSync(join(tmpdir(), "create-ogs-app-edges-"));

function cliIO(replies: string[]) {
  const err: string[] = [];
  const out: string[] = [];
  const io: CliIO = {
    cwd: tmp(),
    ask: async () => replies.shift() ?? "",
    log: (m) => out.push(m),
    error: (m) => err.push(m),
  };
  return { io, err, out };
}

describe("main", () => {
  it("says why an answer was asked again on stderr", async () => {
    const { io, err } = cliIO(["34s", "34S957HD77"]);
    const code = await main(
      [
        "app",
        "--app-id",
        "rocket-crew",
        "--game-url",
        "https://rocketcrew.tv/p",
        "--name",
        "Rocket Crew",
      ].concat(
        [
          "--bundle-id",
          "tv.rocketcrew.app",
          "--package",
          "tv.rocketcrew.app",
          "--link-domain",
          "rocketcrew.tv",
        ],
        ["--branding", "hidden"],
      ),
      io,
    );
    expect(code).toBe(0);
    expect(err).toEqual([expect.stringMatching(/^Apple Team ID .*10/)]);
  });

  it("names the current directory '.' in the next steps", async () => {
    const { io, out } = cliIO([]);
    const code = await main(
      [
        ".",
        "--app-id",
        "rocket-crew",
        "--game-url",
        "https://rocketcrew.tv/p",
        "--team-id",
        "34S957HD77",
        "-y",
      ],
      io,
    );
    expect(code).toBe(0);
    expect(out[1]).toContain("Your app is in .. Next:");
    expect(out[1]).toMatch(/^ {2}cd \.$/m);
  });
});

describe("generateApp", () => {
  it("returns the files it wrote, as paths in the app", async () => {
    const files = await generateApp({ targetDir: join(tmp(), "app"), answers: rocketCrew });
    expect(files).toContain("app.config.ts");
    expect(files).toContain("assets/icon.png");
    expect(files.every((f) => typeof f === "string" && !f.startsWith("/"))).toBe(true);
  });

  it("refuses a directory with files in it, by name", async () => {
    const dir = tmp();
    await generateApp({ targetDir: join(dir, "app"), answers: rocketCrew });
    const error = await generateApp({ targetDir: join(dir, "app"), answers: rocketCrew }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TargetNotEmptyError);
    expect(error instanceof Error && error.name).toBe("TargetNotEmptyError");
  });
});

describe("InputEndedError", () => {
  it("is named", () => {
    expect(new InputEndedError().name).toBe("InputEndedError");
  });
});

describe("AnswersSchema edges", () => {
  it("refuses a link domain over 253 characters", () => {
    const label = "a".repeat(60);
    const long = `${[label, label, label, label].join(".")}.example.com`;
    expect(long.length).toBeGreaterThan(253);
    expect(AnswersSchema.shape.linkDomains.safeParse([long]).success).toBe(false);
  });

  it("accepts an Android package whose first part is longer than two letters", () => {
    expect(AnswersSchema.shape.androidPackage.safeParse("com.example.game").success).toBe(true);
  });
});

describe("collectAnswers edges", () => {
  const without = <K extends keyof Answers>(key: K) => {
    const { [key]: _drop, ...rest } = rocketCrew;
    return rest;
  };

  it("with --yes, a bad flag's error names the flag", async () => {
    const ask = async () => "";
    const cases: [Partial<Args>, RegExp][] = [
      [{ dir: "   " }, /^<dir> /],
      [{ name: 'Rocket "Crew"' }, /^--name /],
      [{ linkDomains: ["https://rocketcrew.tv"] }, /^--link-domain /],
      [{ branding: "loud" }, /^--branding /],
    ];
    for (const [bad, message] of cases) {
      const result = await collectAnswers({ ...rocketCrew, ...bad, ...flags }, { ask });
      expect({ bad, error: !result.ok && result.error }).toEqual({
        bad,
        error: expect.stringMatching(message),
      });
    }
  });

  it("with --yes, lists every missing flag, comma-separated", async () => {
    const { appId: _a, teamId: _t, ...rest } = rocketCrew;
    const result = await collectAnswers({ ...rest, ...flags }, { ask: async () => "" });
    expect(!result.ok && result.error).toMatch(/^--yes needs --app-id, --team-id$/m);
  });

  it("a shell version that isn't one fails the answers", async () => {
    const result = await collectAnswers(
      { ...rocketCrew, shellVersion: "   ", ...flags },
      { ask: async () => "" },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.length).toBeGreaterThan(0);
  });

  it("a blank reply takes the default without asking again", async () => {
    const asked: string[] = [];
    const result = await collectAnswers(
      { ...without("dir"), yes: false, help: false },
      {
        ask: async (q) => {
          asked.push(q);
          return "   ";
        },
      },
    );
    expect(result.ok && result.answers.dir).toBe("app");
    expect(asked).toHaveLength(1);
  });

  it("an empty reply with no default is checked as an empty answer", async () => {
    const replies = ["", "rocket-crew"];
    const warnings: string[] = [];
    const result = await collectAnswers(
      { ...without("appId"), yes: false, help: false },
      { ask: async () => replies.shift() ?? "", warn: (m) => warnings.push(m) },
    );
    expect(result.ok && result.answers.appId).toBe("rocket-crew");
    expect(warnings).toEqual([expect.stringMatching(/^OGS app id must be your OGS catalogue id/)]);
  });
});

describe("renderTemplate", () => {
  it("names every unknown placeholder, comma-separated", () => {
    const values = placeholderValues(rocketCrew);
    expect(() => renderTemplate("__OGS_NOPE__ __OGS_ALSO__", values)).toThrow(
      "unknown template placeholder __OGS_NOPE__, __OGS_ALSO__",
    );
  });
});

describe("drawAsset", () => {
  it("lights exactly the pixels whose centres lie in the ring", () => {
    const png = drawAsset("splash-icon", "#2a5c8a");
    let at = 8;
    const idat: Buffer[] = [];
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      if (png.subarray(at + 4, at + 8).toString("ascii") === "IDAT") {
        idat.push(png.subarray(at + 8, at + 8 + length));
      }
      at += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const size = 1024;
    const c = size / 2;
    const outer = (0.3 * size) ** 2;
    const inner = (0.2 * size) ** 2;
    let wrong = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = (x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2;
        const lit = (raw[y * (size * 4 + 1) + 1 + x * 4 + 3] ?? 0) === 255;
        if (lit !== (d >= inner && d <= outer)) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });
});

describe("no Team ID yet", () => {
  it("drops only whole eas.json lines with an empty Team ID, last entry or not", () => {
    const eas = [
      "{",
      '  "build": {',
      '    "ios": { "appleTeamId": "" },',
      '    "ios": { "appleTeamId": "" }',
      '    "x": 1, "ios": { "appleTeamId": "" },',
      "  }",
      "}",
      "",
    ].join("\n");
    expect(withoutEmptyTeamIds(eas)).toBe(
      ["{", '  "build": {', '    "x": 1, "ios": { "appleTeamId": "" },', "  }", "}", ""].join("\n"),
    );
  });

  it("the next steps say where the Team ID goes, after a blank line", () => {
    expect(nextSteps({ ...rocketCrew, teamId: "" }, "app")).toContain(
      "\n\nThe simulator needs no Apple account.",
    );
  });
});
