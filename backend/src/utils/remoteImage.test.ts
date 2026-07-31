import {
  createPinnedLookup,
  isBlockedRemoteAddress,
  isSameHostOrSubdomain,
  normalizeIpAddress,
} from "./remoteImage";

describe("remoteImage helpers", () => {
  test("detects same host and subdomains", () => {
    expect(isSameHostOrSubdomain("stgy.jp", "stgy.jp")).toBe(true);
    expect(isSameHostOrSubdomain("images.stgy.jp", "stgy.jp")).toBe(true);
    expect(isSameHostOrSubdomain("foo.bar.stgy.jp", "stgy.jp")).toBe(true);
    expect(isSameHostOrSubdomain("example.com", "stgy.jp")).toBe(false);
    expect(isSameHostOrSubdomain("evilstgy.jp", "stgy.jp")).toBe(false);
  });

  test("returns the pinned address in the format requested by Node", () => {
    const lookup = createPinnedLookup({ address: "203.0.113.20", family: 4 });

    let allResult: string | Array<{ address: string; family: number }> | undefined;
    lookup("example.com", { all: true }, (error, address) => {
      expect(error).toBeNull();
      allResult = address;
    });
    expect(allResult).toEqual([{ address: "203.0.113.20", family: 4 }]);

    let singleResult: string | Array<{ address: string; family: number }> | undefined;
    let singleFamily: number | undefined;
    lookup("example.com", { all: false }, (error, address, family) => {
      expect(error).toBeNull();
      singleResult = address;
      singleFamily = family;
    });
    expect(singleResult).toBe("203.0.113.20");
    expect(singleFamily).toBe(4);
  });

  test("normalizes ipv4-mapped ipv6", () => {
    expect(normalizeIpAddress("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIpAddress("2001:db8::1")).toBe("2001:db8::1");
  });

  test("blocks private and reserved addresses", () => {
    expect(isBlockedRemoteAddress("127.0.0.1")).toBe(true);
    expect(isBlockedRemoteAddress("10.0.0.8")).toBe(true);
    expect(isBlockedRemoteAddress("172.20.1.4")).toBe(true);
    expect(isBlockedRemoteAddress("192.168.1.12")).toBe(true);
    expect(isBlockedRemoteAddress("169.254.10.20")).toBe(true);
    expect(isBlockedRemoteAddress("100.64.1.10")).toBe(true);
    expect(isBlockedRemoteAddress("203.0.113.10")).toBe(true);
    expect(isBlockedRemoteAddress("::1")).toBe(true);
    expect(isBlockedRemoteAddress("fc00::1")).toBe(true);
    expect(isBlockedRemoteAddress("fe80::1")).toBe(true);
    expect(isBlockedRemoteAddress("2001:db8::1")).toBe(true);
  });

  test("allows ordinary public addresses", () => {
    expect(isBlockedRemoteAddress("8.8.8.8")).toBe(false);
    expect(isBlockedRemoteAddress("1.1.1.1")).toBe(false);
    expect(isBlockedRemoteAddress("2606:4700:4700::1111")).toBe(false);
  });
});
