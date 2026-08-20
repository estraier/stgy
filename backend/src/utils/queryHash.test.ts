import { canonicalizeQuery, makeQueryHash, verifyQueryHash } from "./queryHash";

describe("queryHash", () => {
  test("canonicalizes decoded parameters including duplicate keys", () => {
    const search = new URLSearchParams("c=111&a=222&b=444&b=333");

    expect(canonicalizeQuery(search)).toBe("a=222&b=333&b=444&c=111");
    expect(makeQueryHash(search)).toBe("d5dd857313b1b13cdda08e5d9ed98fef264884d7");
  });

  test("normalizes equivalent URL encodings before hashing", () => {
    const percentEncoded = new URLSearchParams("q=a%20b");
    const plusEncoded = new URLSearchParams("q=a+b");

    expect(canonicalizeQuery(percentEncoded)).toBe("q=a%20b");
    expect(canonicalizeQuery(plusEncoded)).toBe("q=a%20b");
    expect(makeQueryHash(percentEncoded)).toBe(makeQueryHash(plusEncoded));
  });

  test("verifies the X-STGY-QueryHash header against all query parameters", () => {
    const hash = makeQueryHash(new URLSearchParams("a=222&b=333"));

    expect(verifyQueryHash("/x?b=333&a=222", hash)).toBe(true);
    expect(verifyQueryHash("/x?b=333&a=222", undefined)).toBe(false);
    expect(verifyQueryHash("/x?b=333&a=222", "bad")).toBe(false);
  });
});
