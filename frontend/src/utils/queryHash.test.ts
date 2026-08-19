import { canonicalizeQuery, makeQueryHash, makeQueryHashHeaders } from "./queryHash";

describe("queryHash", () => {
  test("canonicalizes decoded parameters including duplicate keys", async () => {
    const search = new URLSearchParams("c=111&a=222&b=444&b=333");

    expect(canonicalizeQuery(search)).toBe("a=222&b=333&b=444&c=111");
    await expect(makeQueryHash(search)).resolves.toBe(
      "d5dd857313b1b13cdda08e5d9ed98fef264884d7",
    );
  });

  test("normalizes equivalent URL encodings before hashing", () => {
    expect(canonicalizeQuery(new URLSearchParams("q=a%20b"))).toBe("q=a%20b");
    expect(canonicalizeQuery(new URLSearchParams("q=a+b"))).toBe("q=a%20b");
  });

  test("returns the custom query-hash header without changing the URL", async () => {
    const search = new URLSearchParams("a=222&b=333");

    await expect(makeQueryHashHeaders(search)).resolves.toEqual({
      "X-STGY-QueryHash": "6723446a720e02f47aadeaa7b8f1729fd990862d",
    });
    expect(search.toString()).toBe("a=222&b=333");
  });
});
