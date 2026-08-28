import { formatUtcMinute, makeMinuteHash, makeMinuteHashHeaders } from "./minuteHash";

describe("minuteHash", () => {
  test("formats the current minute in UTC as YYYYMMDDhhmm", () => {
    expect(formatUtcMinute(new Date("2026-08-28T07:31:45.678Z"))).toBe("202608280731");
  });

  test("hashes the UTC minute with SHA-1", async () => {
    await expect(makeMinuteHash(new Date("2026-08-28T07:31:45.678Z"))).resolves.toBe(
      "4768016d7550f503d64f682da4cf90a9d280b42c",
    );
  });

  test("returns the X-STGY-MinuteHash header", async () => {
    await expect(
      makeMinuteHashHeaders(new Date("2026-08-28T07:31:45.678Z")),
    ).resolves.toEqual({
      "X-STGY-MinuteHash": "4768016d7550f503d64f682da4cf90a9d280b42c",
    });
  });
});
