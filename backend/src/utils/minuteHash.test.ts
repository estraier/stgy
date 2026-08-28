import { formatUtcMinute, makeMinuteHash, verifyMinuteHash } from "./minuteHash";

describe("minuteHash", () => {
  test("formats the current minute in UTC as YYYYMMDDhhmm", () => {
    expect(formatUtcMinute(new Date("2026-08-28T07:31:45.678Z"))).toBe("202608280731");
  });

  test("hashes the UTC minute with SHA-1", () => {
    expect(makeMinuteHash(new Date("2026-08-28T07:31:45.678Z"))).toBe(
      "4768016d7550f503d64f682da4cf90a9d280b42c",
    );
  });

  test("accepts the previous, current, and next minute", () => {
    const now = new Date("2026-08-28T07:31:45.678Z");

    expect(verifyMinuteHash("9b312373ed2eb4ac84156a1bb67d2fb79beb30c2", now)).toBe(true);
    expect(verifyMinuteHash("4768016d7550f503d64f682da4cf90a9d280b42c", now)).toBe(true);
    expect(verifyMinuteHash("8c1dfaa4e3c0b28903dc8bc17bb314df3789c118", now)).toBe(true);
  });

  test("rejects hashes outside the one-minute tolerance and invalid values", () => {
    const now = new Date("2026-08-28T07:31:45.678Z");

    expect(verifyMinuteHash(makeMinuteHash(new Date("2026-08-28T07:29:00.000Z")), now)).toBe(false);
    expect(verifyMinuteHash(undefined, now)).toBe(false);
    expect(verifyMinuteHash("invalid", now)).toBe(false);
  });

  test("handles UTC date boundaries", () => {
    const now = new Date("2026-01-01T00:00:10.000Z");

    expect(verifyMinuteHash("358c9a7566dda4c30050b97b8789b9071aeff18d", now)).toBe(true);
    expect(verifyMinuteHash("8603d19a74c95d3fe27141d05f0f160972ff54f2", now)).toBe(true);
  });
});
