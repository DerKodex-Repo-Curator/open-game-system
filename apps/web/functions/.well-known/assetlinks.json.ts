import { passThrough } from "../_lib/link-file";

/** GET /.well-known/assetlinks.json — the OGS app plus every registered white-label app. */
export const onRequestGet = (ctx: Parameters<typeof passThrough>[0]) =>
  passThrough(ctx, "assetlinks.json");
