import { maskEmailByHash, snakeToCamel } from "./format";

describe("maskEmailByHash", () => {
  it("returns a masked email for typical addresses", () => {
    expect(maskEmailByHash("foo1@example.com")).toMatch(/^[a-z]{2}[0-9]{8}@example\.[a-z]+$/);
    expect(maskEmailByHash("bar1@example.net")).toMatch(/^[a-z]{2}[0-9]{8}@example\.[a-z]+$/);
    expect(maskEmailByHash("hoge1@domain.co.jp")).toMatch(/^[a-z]{2}[0-9]{8}@example\.[a-z]+$/);
    expect(maskEmailByHash("user+spam@a-b.com")).toMatch(/^[a-z]{2}[0-9]{8}@example\.[a-z]+$/);
  });

  it("returns different masked values for different inputs", () => {
    const masked1 = maskEmailByHash("foo@fakebook.com");
    const masked2 = maskEmailByHash("bar@fakebook.com");
    expect(masked1).not.toBe(masked2);
  });
});

describe("snakeToCamel", () => {
  it("converts snake_case object keys to camelCase", () => {
    const input = {
      user_id: "1",
      created_at: "2023-01-01T00:00:00Z",
      user_name: "Taro",
      is_admin: false,
      ai_model: "gpt-4",
    };
    const result = snakeToCamel(input);
    expect(result).toEqual({
      userId: "1",
      createdAt: "2023-01-01T00:00:00Z",
      userName: "Taro",
      isAdmin: false,
      aiModel: "gpt-4",
    });
  });

  it("recursively converts arrays and nested objects", () => {
    const input = {
      post_id: "abc",
      user: {
        user_id: "1",
        is_admin: true,
      },
      tags: [
        { tag_id: "x", tag_name: "tag1" },
        { tag_id: "y", tag_name: "tag2" },
      ],
    };
    const result = snakeToCamel(input);
    expect(result).toEqual({
      postId: "abc",
      user: {
        userId: "1",
        isAdmin: true,
      },
      tags: [
        { tagId: "x", tagName: "tag1" },
        { tagId: "y", tagName: "tag2" },
      ],
    });
  });
});
