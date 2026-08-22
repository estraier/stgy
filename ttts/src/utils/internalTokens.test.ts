import {
  makeSyntheticLabelToken,
  replaceInternalReservedCharWithSpace,
} from "./internalTokens";

describe("internalTokens", () => {
  test("maps U+E000 in external text to U+0020 SPACE", () => {
    expect(replaceInternalReservedCharWithSpace("alpha\uE000beta")).toBe("alpha beta");
  });

  test("creates labels in the reserved synthetic namespace", () => {
    expect(makeSyntheticLabelToken("Owner:ABC")).toBe("\uE000LOwner:ABC");
  });
});
