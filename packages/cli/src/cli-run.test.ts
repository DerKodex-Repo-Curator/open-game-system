import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type Io, run } from "./cli";
import { COMMANDS } from "./commands";
import { CliError } from "./io";
import { printIssues, readManifestJson } from "./manifest";

/** `run`: help, finding the command, and which failures are the user's (exit 1). */
function setup(over: Partial<Io> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    env: { OGS_CONFIG_DIR: "/nonexistent-ogs-config" },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: () => {
      throw new Error("ENOENT");
    },
    fetch: async () => new Response("not found", { status: 404 }),
    ...over,
  };
  return { io, out, err };
}

const HELP = `ogs: the OGS developer tool

  ogs login --app <appId> --key <game API key>
  ogs apps register --ios <bundle id> --team-id <Apple team id>
  ogs apps register --android <package> --sha256 <fingerprint,...> [--google-client-id <id,...>]
  ogs push credentials --ios <AuthKey.p8> --key-id <key id> --team-id <Apple team id>
  ogs push credentials --android <service-account.json>
  ogs doctor [--domain <your link domain>]
  ogs try [--command "..."] [--url <deployed https URL>] [--check-only]
  ogs push send --to <handle>[,<handle>] [--title <t>] [--body <b>] [--url <link>] [--when-open deliver|banner] [--check]
  ogs dev [--manifest <file>] [--start-url <url>] [--tv-url <url>] [--port 4747] [--phones 2] [--lan <ip>]
  ogs init [--app-id <id>] [--name <name>] [--start-url <url>] [--tv-url <url>]
           [--shape couch|live|async] [--tv none|optional|required] [--codemod] [--dry]
  ogs manifest check [file] [--offline]
  ogs publish [file] [--status]

Options: --app <appId> (default: the app you logged in with).
Environment: OGS_API (API base, e.g. a preview), OGS_SITE (link domain to check, default opengame.org),
OGS_CONFIG_DIR (default ~/.config/ogs).`;

describe("ogs", () => {
  it.each([
    [[]],
    [["--help"]],
    [["-h"]],
    [["help"]],
    [[""]],
  ])("%j prints the help", async (argv) => {
    const s = setup();
    expect(await run(argv, s.io)).toBe(0);
    expect(s.out).toEqual([HELP]);
    expect(s.err).toEqual([]);
  });

  it("an unknown command: says so, the help, exit 2", async () => {
    const s = setup();
    expect(await run(["apps", "list", "--x"], s.io)).toBe(2);
    expect(s.err).toEqual([`Unknown command: apps list --x\n\n${HELP}`]);
    expect(s.out).toEqual([]);
  });

  it("a command's words must all match, in order", async () => {
    const s = setup();
    expect(await run(["register", "apps"], s.io)).toBe(2);
    expect(await run(["push"], s.io)).toBe(2);
  });

  it("runs the command with the arguments after its words", async () => {
    const seen: string[][] = [];
    const s = setup();
    const original = COMMANDS.slice();
    COMMANDS.push({
      words: ["push"],
      usage: [],
      run: async (_io, args) => {
        seen.push(args);
        return 7;
      },
    });
    try {
      expect(await run(["push", "x", "y"], s.io)).toBe(7);
      expect(seen).toEqual([["x", "y"]]);
      // The longer command wins over the shorter one that also matches.
      expect(await run(["push", "send"], s.io)).toBe(2);
      expect(seen).toHaveLength(1);
    } finally {
      COMMANDS.splice(0, COMMANDS.length, ...original);
    }
  });

  it.each([
    ["a CliError", new CliError("our message"), "our message"],
    ["a TypeError (a bad flag)", new TypeError("bad flag"), "bad flag"],
    ["a SyntaxError (bad JSON)", new SyntaxError("bad json"), "bad json"],
    [
      "a ZodError (the API's answer)",
      z.object({ a: z.string() }).safeParse({}).error,
      "Unexpected answer from the API",
    ],
  ])("%s: its message, exit 1", async (_, error, message) => {
    const s = setup();
    const original = COMMANDS.slice();
    COMMANDS.unshift({
      words: ["boom"],
      usage: [],
      run: async () => {
        throw error;
      },
    });
    try {
      expect(await run(["boom"], s.io)).toBe(1);
      expect(s.err).toEqual([message]);
    } finally {
      COMMANDS.splice(0, COMMANDS.length, ...original);
    }
  });

  it("anything else is a bug: thrown, not printed", async () => {
    const s = setup();
    const bug = new RangeError("bug");
    const original = COMMANDS.slice();
    COMMANDS.unshift({
      words: ["boom"],
      usage: [],
      run: async () => {
        throw bug;
      },
    });
    try {
      await expect(run(["boom"], s.io)).rejects.toBe(bug);
      expect(s.err).toEqual([]);
    } finally {
      COMMANDS.splice(0, COMMANDS.length, ...original);
    }
  });

  it("a flag a command doesn't take: the parser's message, exit 1", async () => {
    const s = setup();
    expect(await run(["login", "--nope"], s.io)).toBe(1);
    expect(s.err[0]).toMatch(/^Unknown option '--nope'/);
  });
});

describe("the manifest file", () => {
  it("one that can't be read, or isn't JSON, is named", () => {
    const s = setup();
    expect(() => readManifestJson(s.io, "m.json")).toThrow(
      new CliError("Can't read m.json. Run this in the game's repo, or pass the manifest's path."),
    );
    const t = setup({ readFile: () => "{" });
    expect(() => readManifestJson(t.io, "m.json")).toThrow(new CliError("m.json isn't JSON"));
  });

  it("issues: one per line, then the count", () => {
    const s = setup();
    expect(
      printIssues(s.io, [
        { path: "", message: "a" },
        { path: "art.tile", message: "b" },
      ]),
    ).toBe(1);
    expect(s.err).toEqual(["issue (root): a", "issue art.tile: b", "invalid: 2 issues"]);
  });
});
