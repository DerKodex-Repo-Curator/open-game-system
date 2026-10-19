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

type IosPart = NonNullable<NativeConfigPart["ios"]>;

/** The local-network keys Google Cast needs, added to the app's Info.plist without replacing its own. */
function mergeInfoPlist(
  existing: NonNullable<IosConfig["infoPlist"]>,
  part: NonNullable<IosPart["infoPlist"]>,
): NonNullable<IosConfig["infoPlist"]> {
  const bonjour = StringListSchema.safeParse(existing.NSBonjourServices);
  const description = z.string().min(1).safeParse(existing.NSLocalNetworkUsageDescription);
  return {
    ...existing,
    // The app's own words win: additive only.
    NSLocalNetworkUsageDescription: description.success
      ? description.data
      : part.NSLocalNetworkUsageDescription,
    NSBonjourServices: union(bonjour.success ? bonjour.data : [], part.NSBonjourServices, same),
  };
}

function mergeIos(ios: IosConfig | undefined, part: IosPart): IosConfig {
  const out: IosConfig = { ...ios };
  if (part.associatedDomains) {
    out.associatedDomains = union(ios?.associatedDomains ?? [], part.associatedDomains, same);
  }
  if (part.usesAppleSignIn) out.usesAppleSignIn = true;
  if (part.infoPlist) out.infoPlist = mergeInfoPlist(ios?.infoPlist ?? {}, part.infoPlist);
  return out;
}

function mergeAndroid(
  android: ExpoConfig["android"],
  part: NonNullable<NativeConfigPart["android"]>,
): NonNullable<ExpoConfig["android"]> {
  return {
    ...android,
    intentFilters: union(android?.intentFilters ?? [], part.intentFilters, canonical),
  };
}

/** The part's plugins the app doesn't list and Expo hasn't run. */
function pluginsToApply(config: ExpoConfig, part: NativeConfigPart): PluginEntry[] {
  const done = new Set([
    ...appPluginNames(config.plugins),
    ...Object.keys(config._internal?.pluginHistory ?? {}),
  ]);
  return (part.plugins ?? []).filter((entry) => !done.has(pluginName(entry)));
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
  if (part.android) next.android = mergeAndroid(config.android, part.android);
  if (part.extra) next.extra = { ...config.extra, ...part.extra };
  const pendingPlugins = pluginsToApply(config, part);
  return { config: next, pendingPlugins };
}
