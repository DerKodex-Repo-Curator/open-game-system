#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { runCli } from "./cli";
import { createLinePrompt } from "./line-prompt";

const prompt = createLinePrompt(stdin, stdout);

runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  ask: prompt.ask,
  log: (m) => console.log(m),
  error: (m) => console.error(m),
}).then((code) => {
  process.exitCode = code;
  prompt.close();
});
