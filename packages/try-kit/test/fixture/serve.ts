import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Starts the fixture game under wrangler dev for the seam tests (TRY_KIT_URL), and stops it after. */
const PORT = Number(process.env.TRY_KIT_PORT ?? 8956);
let child: ChildProcess | undefined;

export async function setup(): Promise<void> {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  child = spawn("npx", ["wrangler", "dev", "-c", "wrangler.jsonc", "--port", String(PORT), "--persist-to", ".wrangler/seam"], { cwd: dir, stdio: "ignore" });
  process.env.TRY_KIT_URL = `http://localhost:${PORT}`;
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    const up = await fetch(`http://localhost:${PORT}/ws-probe`).then((r) => r.status === 426, () => false);
    if (up) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the fixture didn't start");
}

export async function teardown(): Promise<void> {
  child?.kill();
}
