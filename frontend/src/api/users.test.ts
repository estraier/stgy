import { apiFetch } from "./client";
import { getPubConfig, getUsersKwic, searchUsers, setPubConfig } from "./users";

jest.mock("./client", () => ({
  apiFetch: jest.fn(),
  extractError: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe("user search API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns search tokens and phrases with users", async () => {
    const response = { tokens: ["install", "settings"], phrases: ["install", "settings"], result: [] };
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(response),
    } as unknown as Response);

    await expect(searchUsers({ query: "Install Settings", locale: "en" })).resolves.toEqual(
      response,
    );
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/users/search?query=Install+Settings&locale=en",
      { method: "GET" },
    );
  });
});

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

describe("user public config API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns extensions from public config", async () => {
    const response = {
      siteName: "Site",
      subtitle: "",
      author: "",
      introduction: "",
      designTheme: "",
      showServiceHeader: true,
      showSiteName: true,
      showPagenation: true,
      showSideProfile: true,
      showSideRecent: 5,
      showSidePopular: 5,
      extensions: { shareButtons: ["hatena", "x"] },
    };
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(response),
    } as unknown as Response);

    await expect(getPubConfig("0000000000000001")).resolves.toEqual(response);
    expect(mockApiFetch).toHaveBeenCalledWith("/users/0000000000000001/pub-config", {
      method: "GET",
    });
  });

  test("sends extensions when public config is updated", async () => {
    const extensions = {
      shareButtons: ["facebook"],
      analytics: { googleAnalytics: { measurementId: "G-TEST123" } },
    };
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ extensions }),
    } as unknown as Response);

    await setPubConfig("0000000000000001", { extensions });
    expect(mockApiFetch).toHaveBeenCalledWith("/users/0000000000000001/pub-config", {
      method: "PUT",
      body: JSON.stringify({ extensions }),
    });
  });
});
