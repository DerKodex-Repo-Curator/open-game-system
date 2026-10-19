import { passThrough } from "../_lib/link-file";

/** GET /.well-known/apple-app-site-association — the OGS app plus every registered white-label app. */
export const onRequestGet = (ctx: Parameters<typeof passThrough>[0]) =>
  passThrough(ctx, "apple-app-site-association");
