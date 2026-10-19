import { installLogGuard } from "./log-guard";

// Imported first by the root layout, before anything can log (services/log-guard.ts).
installLogGuard(console, { release: !__DEV__ });
