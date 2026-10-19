import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Every test (and every Stryker mutant) runs with a throwaway HOME, so nothing can write the real
 * ~/.config/ogs. A mutant that ignored OGS_CONFIG_DIR once saved the tests' fake logins over the
 * developer's real game keys (2026-10-19).
 */
const home = mkdtempSync(join(tmpdir(), "ogs-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
