import { describe, expect, it } from "vitest";
import { countDownload, type DataPoint } from "../src/downloads";

/** A stand-in for the Analytics Engine binding: records each data point. */
function dataset() {
  const points: DataPoint[] = [];
  return { points, writeDataPoint: (p: DataPoint) => void points.push(p) };
}

describe("countDownload: starter.tgz and the kits are counted for bet 4 (outside developers)", () => {
  it("a GET of /starter.tgz is one data point in the scoreboard's dataset (index docs, kind download, the path)", () => {
    const d = dataset();
    countDownload(new Request("https://ogs-docs.pages.dev/starter.tgz"), d);
    expect(d.points).toEqual([{ indexes: ["docs"], blobs: ["download", "/starter.tgz", ""], doubles: [1] }]);
  });
  it("a kit counts by its path, with a utm_source if the link had one", () => {
    const d = dataset();
    countDownload(new Request("https://ogs-docs.pages.dev/pkg/profile-kit.tgz?utm_source=hn"), d);
    expect(d.points[0]?.blobs).toEqual(["download", "/pkg/profile-kit.tgz", "hn"]);
  });
  it("HEAD requests and bots don't count", () => {
    const d = dataset();
    countDownload(new Request("https://ogs-docs.pages.dev/starter.tgz", { method: "HEAD" }), d);
    countDownload(new Request("https://ogs-docs.pages.dev/starter.tgz", { headers: { "user-agent": "Googlebot/2.1" } }), d);
    expect(d.points).toEqual([]);
  });
  it("without the binding (a local build), it does nothing", () => {
    expect(() => countDownload(new Request("https://x.dev/starter.tgz"), undefined)).not.toThrow();
  });
});
