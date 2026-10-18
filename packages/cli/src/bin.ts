#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { run } from "./cli";

const code = await run(process.argv.slice(2), {
  env: process.env,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readFile: (path) => readFileSync(path, "utf8"),
  fetch,
});
process.exit(code);
