const REF = /^[a-z0-9_-]{1,32}$/;
const FRONT_DOOR = "https://ogs-front-door.jonathanrmumm.workers.dev/";

/**
 * GET /get-app?utm_source=coop&game=bake-shop: counts the tap (exact, server-side, unlike a page
 * beacon), then sends the person to the public TestFlight link, or, until Jon has one, to the front
 * door with their source kept.
 */
export function getAppRedirect(url: URL, testflightUrl: string | undefined, counter: Pick<AnalyticsEngineDataset, "writeDataPoint">): Response {
  const raw = (url.searchParams.get("utm_source") ?? url.searchParams.get("src") ?? "").toLowerCase();
  const source = REF.test(raw) ? raw : "direct";
  const game = (url.searchParams.get("game") ?? "").toLowerCase();
  counter.writeDataPoint({ indexes: ["get-app"], blobs: ["get_app", source, REF.test(game) ? game : ""], doubles: [1] });
  const to = testflightUrl?.startsWith("https://") ? testflightUrl : `${FRONT_DOOR}?utm_source=${source}`;
  return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
}
