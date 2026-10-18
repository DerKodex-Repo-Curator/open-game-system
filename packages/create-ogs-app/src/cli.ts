import { relative, resolve } from "node:path";
import { generateApp, TargetNotEmptyError } from "./generate";
import { HELP, nextSteps } from "./next-steps";
import { collectAnswers, parseArgs } from "./options";

export interface CliIO {
  cwd: string;
  /** Asks one question; an empty reply takes `fallback`. */
  ask: (question: string, fallback?: string) => Promise<string>;
  log: (message: string) => void;
  error: (message: string) => void;
  templateDir?: string;
}

/** `create-ogs-app [dir] [flags]`. Exit codes: 0 done, 1 could not write, 2 bad input. */
export async function main(argv: string[], io: CliIO): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    io.error(`${parsed.error}\n\n${HELP}`);
    return 2;
  }
  if (parsed.args.help) {
    io.log(HELP);
    return 0;
  }
  const collected = await collectAnswers(parsed.args, {
    ask: io.ask,
    warn: (m) => io.error(m),
  });
  if (!collected.ok) {
    io.error(collected.error);
    return 2;
  }
  const { answers } = collected;
  const targetDir = resolve(io.cwd, answers.dir);
  try {
    const files = await generateApp({ targetDir, answers, templateDir: io.templateDir });
    const shown = relative(io.cwd, targetDir) || ".";
    io.log(`Made ${answers.name} (${files.length} files).\n`);
    io.log(nextSteps(answers, shown));
    return 0;
  } catch (error) {
    if (error instanceof TargetNotEmptyError) {
      io.error(error.message);
      return 1;
    }
    throw error;
  }
}
