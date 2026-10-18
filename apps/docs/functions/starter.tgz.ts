import { type Counter, countDownload } from "../src/downloads";

/** GET /starter.tgz: count the download (bet 4), then serve the static file. */
export const onRequestGet = ({ request, env, next }: { request: Request; env: { DOWNLOADS?: Counter }; next: () => Promise<Response> }) => {
  countDownload(request, env.DOWNLOADS);
  return next();
};
