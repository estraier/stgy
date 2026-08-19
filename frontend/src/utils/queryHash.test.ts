import { appendQueryHash, canonicalizeQuery, makeQueryHash } from "./queryHash";

describe("queryHash", () => {
  test("canonicalizes decoded parameters including duplicate keys", async () => {
    const search = new URLSearchParams("c=111&a=222&b=444&b=333&queryhash=ignored");

    expect(canonicalizeQuery(search)).toBe("a=222&b=333&b=444&c=111");
    await expect(makeQueryHash(search)).resolves.toBe(
      "d5dd857313b1b13cdda08e5d9ed98fef264884d7",
    );
  });

  test("normalizes equivalent URL encodings before hashing", () => {
    expect(canonicalizeQuery(new URLSearchParams("q=a%20b"))).toBe("q=a%20b");
    expect(canonicalizeQuery(new URLSearchParams("q=a+b"))).toBe("q=a%20b");
  });

  test("replaces an existing queryhash", async () => {
    const search = new URLSearchParams("a=222&queryhash=old&b=333");

    await appendQueryHash(search);

    expect(search.getAll("queryhash")).toEqual(["6723446a720e02f47aadeaa7b8f1729fd990862d"]);
  });
});
