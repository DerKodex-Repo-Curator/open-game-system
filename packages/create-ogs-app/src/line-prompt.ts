import { createInterface } from "node:readline";

export class InputEndedError extends Error {
  constructor() {
    super("the input ended before every question was answered (or pass the flags with --yes)");
    this.name = "InputEndedError";
  }
}

/**
 * Questions on a terminal, or on piped input: lines that arrive before their question is asked
 * are kept for it (readline's own question() drops them), and a question after the input ends
 * fails instead of waiting forever.
 */
export function createLinePrompt(input: NodeJS.ReadableStream, output: NodeJS.WritableStream) {
  const rl = createInterface({ input, terminal: false });
  const lines: string[] = [];
  const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
  let ended = false;

  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next) next.resolve(line);
    else lines.push(line);
  });
  rl.on("close", () => {
    ended = true;
    for (const w of waiting.splice(0)) w.reject(new InputEndedError());
  });

  return {
    ask(question: string, fallback?: string): Promise<string> {
      output.write(fallback ? `? ${question} (${fallback}) ` : `? ${question} `);
      const line = lines.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (ended) return Promise.reject(new InputEndedError());
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    close: () => rl.close(),
  };
}
