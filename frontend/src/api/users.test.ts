import { apiFetch } from "./client";
import { getUsersKwic } from "./users";

jest.mock("./client", () => ({
  apiFetch: jest.fn(),
  extractError: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe("user KWIC API", () => {
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
      getUsersKwic(
        ["0000000000000001", "0000000000000002"],
        ["alpha", "hot dog"],
      ),
    ).resolves.toEqual(response);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/users/kwic?id=0000000000000001&id=0000000000000002&keyword=alpha&keyword=hot+dog",
      { method: "GET" },
    );
  });
});
