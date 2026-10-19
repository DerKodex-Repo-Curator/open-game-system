import { ManifestSchema } from "@open-game-system/ogs-protocol";

/** The manifest `ogs init` writes: the fields the flags or prompts give, the art kit's usual paths. */
export type ManifestInput = {
  appId: string;
  name: string;
  startUrl: string;
  tvUrl?: string;
  shape?: string;
  tv?: string;
};

export function draftManifest(i: ManifestInput) {
  const art = `/art/${i.appId}`;
  return {
    appId: i.appId,
    name: i.name,
    shape: i.shape ?? "couch",
    tv: i.tv ?? (i.tvUrl ? "required" : "optional"),
    startUrl: i.startUrl,
    ...(i.tvUrl ? { tvUrl: i.tvUrl } : {}),
    art: {
      tile: `${art}/tv.jpg`,
      icon: `${art}/icon.png`,
      cover: `${art}/cover.jpg`,
      logo: `${art}/logo.png`,
      heroClean: `${art}/hero-clean.jpg`,
    },
  };
}

export type Issue = { path: string; message: string };

/** ManifestSchema's verdict: the manifest, or its issues (paths joined with "."). */
export function checkManifest(
  value: unknown,
):
  | { ok: true; manifest: { appId: string; name: string; startUrl: string; tvUrl?: string } }
  | { ok: false; issues: Issue[] } {
  const parsed = ManifestSchema.safeParse(value);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}
