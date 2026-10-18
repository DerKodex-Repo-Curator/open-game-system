#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { run } from "./cli";

/** A shell command, its output passed through to the terminal and kept (ogs try reads the URL from it). */
const exec = (command: string, opts: { cwd: string }) =>
  new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });

const code = await run(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readFile: (path) => readFileSync(path, "utf8"),
  fetch,
  exec,
});
process.exit(code);
