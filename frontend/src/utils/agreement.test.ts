import type { SessionInfo } from "@/api/models";
import {
  makeAgreementPageUrl,
  needsAgreement,
  sanitizeAgreementReturnPath,
  selectAgreementContent,
} from "./agreement";

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    userId: "0001000000000001",
    userEmail: "user@example.com",
    userNickname: "user",
    userIsAdmin: false,
    userCreatedAt: "2026-01-01T00:00:00.000Z",
    userUpdatedAt: null,
    userLocale: "ja-JP",
    userTimezone: "Asia/Tokyo",
    loggedInAt: "2026-08-02T00:00:00.000Z",
    requiredAgreementTermId: null,
    ...overrides,
  };
}

describe("agreement helpers", () => {
  test("requires an agreement only for non-admin sessions with a required ID", () => {
    expect(needsAgreement(session())).toBe(false);
    expect(
      needsAgreement(session({ requiredAgreementTermId: "19F3FC04CB800000" })),
    ).toBe(true);
    expect(
      needsAgreement(
        session({
          userIsAdmin: true,
          requiredAgreementTermId: "19F3FC04CB800000",
        }),
      ),
    ).toBe(false);
  });

  test("selects exact locale, language locale, and English in that order", () => {
    const contents = [
      { locale: "en", text: "English" },
      { locale: "ja", text: "日本語" },
      { locale: "ja-JP", text: "日本向け" },
    ];
    expect(selectAgreementContent(contents, "ja-JP")?.text).toBe("日本向け");
    expect(selectAgreementContent(contents.slice(0, 2), "ja-JP")?.text).toBe("日本語");
    expect(selectAgreementContent(contents, "fr-FR")?.text).toBe("English");
  });

  test("returns null when no matching or English content exists", () => {
    expect(selectAgreementContent([{ locale: "ja", text: "日本語" }], "fr")).toBeNull();
  });

  test("keeps safe internal return paths", () => {
    expect(sanitizeAgreementReturnPath("/posts/ABC?q=1#x")).toBe(
      "/posts/ABC?q=1#x",
    );
  });

  test("rejects external, protocol-relative, and recursive return paths", () => {
    expect(sanitizeAgreementReturnPath("https://example.com/")).toBe("/posts");
    expect(sanitizeAgreementReturnPath("//example.com/")).toBe("/posts");
    expect(sanitizeAgreementReturnPath("/\\example.com/")).toBe("/posts");
    expect(sanitizeAgreementReturnPath("/user-agreement?next=/posts")).toBe("/posts");
  });

  test("builds the agreement page URL with encoded parameters", () => {
    expect(makeAgreementPageUrl("/posts?q=a b")).toBe(
      "/user-agreement?next=%2Fposts%3Fq%3Da%2520b",
    );
  });
});
