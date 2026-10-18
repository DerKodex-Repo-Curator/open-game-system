#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { main } from "./cli";
import { createLinePrompt, InputEndedError } from "./line-prompt";

const prompt = createLinePrompt(stdin, stdout);

main(process.argv.slice(2), {
  cwd: process.cwd(),
  ask: prompt.ask,
  log: (m) => console.log(m),
  error: (m) => console.error(m),
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof InputEndedError ? `\n${error.message}` : error);
    process.exitCode = error instanceof InputEndedError ? 2 : 1;
  })
  .finally(() => prompt.close());
