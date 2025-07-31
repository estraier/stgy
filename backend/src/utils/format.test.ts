import { maskEmailByHash } from "./format";

describe("maskEmailByHash", () => {
  it("returns a masked email for typical addresses", () => {
    expect(maskEmailByHash("foo1@example.com")).toMatch(
      /^[a-z]{2}[0-9]{8}@example\.[a-z]+$/
    );
    expect(maskEmailByHash("bar1@example.net")).toMatch(
      /^[a-z]{2}[0-9]{8}@example\.[a-z]+$/
    );
    expect(maskEmailByHash("hoge1@domain.co.jp")).toMatch(
      /^[a-z]{2}[0-9]{8}@example\.[a-z]+$/
    );
    expect(maskEmailByHash("user+spam@a-b.com")).toMatch(
      /^[a-z]{2}[0-9]{8}@example\.[a-z]+$/
    );
  });

  it("returns different masked values for different inputs", () => {
    const masked1 = maskEmailByHash("foo@fakebook.com");
    const masked2 = maskEmailByHash("bar@fakebook.com");
    expect(masked1).not.toBe(masked2);
  });
});
