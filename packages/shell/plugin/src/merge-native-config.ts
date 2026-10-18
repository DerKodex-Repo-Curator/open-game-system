import type { ExpoConfig } from "expo/config";
import { z } from "zod";
import type { NativeConfig, PluginEntry } from "./native-config";

/** A slice of the native config: what one sub-plugin writes. */
export type NativeConfigPart = {
  icon?: string;
  ios?: Partial<NativeConfig["ios"]>;
  android?: NativeConfig["android"];
  plugins?: PluginEntry[];
  extra?: NativeConfig["extra"];
};

type IosConfig = NonNullable<ExpoConfig["ios"]>;
type AppPlugins = ExpoConfig["plugins"];

const StringListSchema = z.array(z.string());

const union = <T>(existing: readonly T[], added: readonly T[], key: (item: T) => string): T[] => {
  const seen = new Set(existing.map(key));
  const out = [...existing];
  for (const item of added) {
    if (seen.has(key(item))) continue;
    seen.add(key(item));
    out.push(item);
  }
  return out;
};

/** JSON with sorted keys, so equal content compares equal whatever its key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const same = (s: string) => s;

export const pluginName = (entry: PluginEntry): string =>
  typeof entry === "string" ? entry : entry[0];

function appPluginNames(plugins: AppPlugins): string[] {
  const names: string[] = [];
  for (const entry of plugins ?? []) {
    if (typeof entry === "string") names.push(entry);
    else if (Array.isArray(entry) && typeof entry[0] === "string") names.push(entry[0]);
  }
  return names;
}

function mergeIos(
  ios: IosConfig | undefined,
  part: NonNullable<NativeConfigPart["ios"]>,
): IosConfig {
  const out: IosConfig = { ...ios };
  if (part.associatedDomains) {
    out.associatedDomains = union(ios?.associatedDomains ?? [], part.associatedDomains, same);
  }
  if (part.usesAppleSignIn) out.usesAppleSignIn = true;
  if (part.infoPlist) {
    const existing = ios?.infoPlist ?? {};
    const bonjour = StringListSchema.safeParse(existing.NSBonjourServices);
    const description = z.string().min(1).safeParse(existing.NSLocalNetworkUsageDescription);
    out.infoPlist = {
      ...existing,
      // The app's own words win: additive only.
      NSLocalNetworkUsageDescription: description.success
        ? description.data
        : part.infoPlist.NSLocalNetworkUsageDescription,
      NSBonjourServices: union(
        bonjour.success ? bonjour.data : [],
        part.infoPlist.NSBonjourServices,
        same,
      ),
    };
  }
  return out;
}

/**
 * Merges a native config (or a slice of it) into an Expo app config. Additive and idempotent: nothing
 * the app already has is duplicated or replaced (except extra.ogsShell, which is derived), and the
 * developer's identity is never touched. Returns the plugins still to apply: those the app doesn't list
 * and Expo hasn't run.
 */
export function mergeNativeConfig(
  config: ExpoConfig,
  part: NativeConfigPart,
): { config: ExpoConfig; pendingPlugins: PluginEntry[] } {
  const next: ExpoConfig = { ...config };
  if (part.icon) next.icon = part.icon;
  if (part.ios) next.ios = mergeIos(config.ios, part.ios);
  if (part.android) {
    next.android = {
      ...config.android,
      intentFilters: union(
        config.android?.intentFilters ?? [],
        part.android.intentFilters,
        canonical,
      ),
    };
  }
  if (part.extra) next.extra = { ...config.extra, ...part.extra };
  const done = new Set([
    ...appPluginNames(config.plugins),
    ...Object.keys(config._internal?.pluginHistory ?? {}),
  ]);
  const pendingPlugins = (part.plugins ?? []).filter((entry) => !done.has(pluginName(entry)));
  return { config: next, pendingPlugins };
}
