import { apiFetch, extractError } from "./client";
import { decodeGeo, encodeGeo } from "./geo";

jest.mock("./client", () => ({
  apiFetch: jest.fn(),
  extractError: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockExtractError = extractError as jest.MockedFunction<typeof extractError>;

function jsonResponse(value: unknown, ok = true, status = ok ? 200 : 400): Response {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(value),
  } as unknown as Response;
}

describe("geo API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("encodes a place name", async () => {
    const payload = [
      {
        level: 3,
        country: "JP",
        longitude: 139.461129,
        latitude: 35.803146,
        addresses: [
          {
            locale: "ja",
            label: "日本埼玉県所沢市",
            elements: ["日本", "埼玉県", "所沢市"],
          },
        ],
      },
    ];
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await expect(encodeGeo("埼玉県所沢市", "ja")).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/geo/encode?query=%E5%9F%BC%E7%8E%89%E7%9C%8C%E6%89%80%E6%B2%A2%E5%B8%82&locale=ja&queryhash=990e321bc7faf79a6188f956e44e68534a2421a1",
      { method: "GET" },
    );
  });

  test("returns an empty array when the place is not found", async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ error: "not found" }, false, 404));

    await expect(encodeGeo("存在しない地名")).resolves.toEqual([]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/geo/encode?query=%E5%AD%98%E5%9C%A8%E3%81%97%E3%81%AA%E3%81%84%E5%9C%B0%E5%90%8D&queryhash=786e33d383c3fabfa8bc2409d77f6d7e3cf467ab",
      { method: "GET" },
    );
    expect(mockExtractError).not.toHaveBeenCalled();
  });


  test("decodes coordinates", async () => {
    const payload = [
      {
        level: 3,
        country: "JP",
        longitude: 138.31795,
        latitude: 36.3603,
        addresses: [
          {
            locale: "ja",
            label: "日本長野県上田市",
            elements: ["日本", "長野県", "上田市"],
          },
        ],
      },
    ];
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await expect(decodeGeo(138.31795, 36.3603, "ja")).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/geo/decode?longitude=138.31795&latitude=36.3603&locale=ja&queryhash=1f3f5f2a4107d9f7a018d453cd9efbdda5cd8049",
      { method: "GET" },
    );
  });

  test("returns an empty array when coordinates are not found", async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ error: "not found" }, false, 404));

    await expect(decodeGeo(0, 0)).resolves.toEqual([]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/geo/decode?longitude=0&latitude=0&queryhash=0a97f843c3187a4aae9de3df52d9cb42a9e09ba7",
      { method: "GET" },
    );
    expect(mockExtractError).not.toHaveBeenCalled();
  });

  test("uses the backend error message", async () => {
    const response = jsonResponse({}, false, 403);
    mockApiFetch.mockResolvedValue(response);
    mockExtractError.mockResolvedValue("too often operations");

    await expect(encodeGeo("埼玉県所沢市")).rejects.toThrow("too often operations");
    expect(mockExtractError).toHaveBeenCalledWith(response);
  });
});
