import { apiFetch } from "./client";
import { getPostsKwic, getPubPostsKwic, searchPubPostsByUser } from "./posts";

jest.mock("./client", () => ({
  apiFetch: jest.fn(),
  extractError: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe("public post search API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("adds X-STGY-QueryHash and forces an anonymous request", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([]),
    } as unknown as Response);

    await expect(
      searchPubPostsByUser({
        query: "foo",
        userId: "0000000000000001",
        offset: 0,
        limit: 6,
        locale: "ja",
        order: "desc",
      }),
    ).resolves.toEqual([]);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/posts/search?query=foo&ownedBy=0000000000000001&offset=0&limit=6&locale=ja&order=desc",
      {
        method: "GET",
        credentials: "omit",
        headers: {
          "X-STGY-QueryHash": "f47067dfef0a91ceac8188ed85e174c41a14e1d3",
        },
      },
    );
  });
});


describe("post KWIC API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("sends repeated id and keyword query parameters", async () => {
    const response = [
      {
        id: "0000000000000001",
        kwic: { version: 1, title: null, segments: [] },
      },
    ];
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(response),
    } as unknown as Response);

    await expect(
      getPostsKwic(
        ["0000000000000001", "0000000000000002"],
        ["alpha", "hot dog"],
      ),
    ).resolves.toEqual(response);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/posts/kwic?id=0000000000000001&id=0000000000000002&keyword=alpha&keyword=hot+dog",
      { method: "GET" },
    );
  });
});


describe("public post KWIC API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("adds X-STGY-QueryHash and forces an anonymous request", async () => {
    const response = [
      {
        id: "0000000000000001",
        kwic: { version: 1, title: null, segments: [] },
      },
    ];
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(response),
    } as unknown as Response);

    await expect(
      getPubPostsKwic(
        ["0000000000000001", "0000000000000002"],
        ["alpha", "hot dog"],
      ),
    ).resolves.toEqual(response);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/posts/kwic-pub?id=0000000000000001&id=0000000000000002&keyword=alpha&keyword=hot+dog",
      {
        method: "GET",
        credentials: "omit",
        headers: {
          "X-STGY-QueryHash": "7adc28b0fead43fbf7f0b2d7e9ed653e2532bb4a",
        },
      },
    );
  });
});
