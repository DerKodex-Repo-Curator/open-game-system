import type { NetworkInterfaceInfo } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** `ogs dev`'s LAN address, from a stand-in list of network interfaces. */
const interfaces: { value: Record<string, NetworkInterfaceInfo[] | undefined> } = { value: {} };
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  networkInterfaces: () => interfaces.value,
}));
const { lanAddress } = await import("./server");

const info = (address: string, family: "IPv4" | "IPv6", internal: boolean): NetworkInterfaceInfo =>
  family === "IPv4"
    ? { address, family, internal, netmask: "", mac: "", cidr: null }
    : { address, family, internal, netmask: "", mac: "", cidr: null, scopeid: 0 };

beforeEach(() => {
  interfaces.value = {};
});

describe("the LAN address", () => {
  it("the first IPv4 address that isn't loopback, across interfaces", () => {
    interfaces.value = {
      lo0: [info("127.0.0.1", "IPv4", true)],
      gone: undefined,
      en0: [info("fe80::1", "IPv6", false), info("192.168.1.20", "IPv4", false)],
      en1: [info("10.0.0.2", "IPv4", false)],
    };
    expect(lanAddress()).toBe("192.168.1.20");
  });

  it("none: null", () => {
    interfaces.value = {
      lo0: [info("127.0.0.1", "IPv4", true), info("::1", "IPv6", true)],
      en0: [info("fe80::1", "IPv6", false)],
    };
    expect(lanAddress()).toBeNull();
    interfaces.value = {};
    expect(lanAddress()).toBeNull();
  });
});
