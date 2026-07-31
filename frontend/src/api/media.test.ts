import { apiFetch, extractError } from "./client";
import { importRemoteImage } from "./media";

jest.mock("./client", () => ({
  apiFetch: jest.fn(),
  extractError: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockExtractError = extractError as jest.MockedFunction<typeof extractError>;

describe("importRemoteImage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("fetches image bytes through the admin import endpoint", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const response = {
      ok: true,
      blob: jest.fn().mockResolvedValue(blob),
    } as unknown as Response;
    mockApiFetch.mockResolvedValue(response);

    await expect(importRemoteImage("u 1", "https://example.com/image.png")).resolves.toBe(blob);
    expect(mockApiFetch).toHaveBeenCalledWith("/media/u%201/images/import", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/image.png" }),
    });
  });

  test("uses the backend error message", async () => {
    const response = { ok: false } as Response;
    mockApiFetch.mockResolvedValue(response);
    mockExtractError.mockResolvedValue("remote image host is not allowed");

    await expect(importRemoteImage("u1", "https://stgy.jp/image.png")).rejects.toThrow(
      "remote image host is not allowed",
    );
    expect(mockExtractError).toHaveBeenCalledWith(response);
  });
});
