import { apiFetch } from "./client";
import { searchPubPostsByUser } from "./posts";

jest.mock("./client", () => ({
  apiFetch: jest.fn(),
  extractError: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe("public post search API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("adds queryhash and forces an anonymous request", async () => {
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
      "/posts/search?query=foo&ownedBy=0000000000000001&offset=0&limit=6&locale=ja&order=desc&queryhash=f47067dfef0a91ceac8188ed85e174c41a14e1d3",
      { method: "GET", credentials: "omit" },
    );
  });
});
