import { apiFetch, extractError } from "./client";
import { getSessionInfo, switchLoginAccount } from "./auth";

jest.mock("./client", () => ({
  apiFetch: jest.fn(),
  extractError: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockExtractError = extractError as jest.MockedFunction<typeof extractError>;

function jsonResponse(value: unknown, ok = true): Response {
  return {
    ok,
    json: jest.fn().mockResolvedValue(value),
  } as unknown as Response;
}

describe("auth API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("gets current session information without browser caching", async () => {
    const payload = {
      userId: "0001000000000001",
      userEmail: "admin@stgy.jp",
      userNickname: "admin",
      userIsAdmin: true,
      userCreatedAt: "2026-01-01T00:00:00.000Z",
      userUpdatedAt: null,
      userLocale: "en",
      userTimezone: "UTC",
      loggedInAt: "2026-08-02T00:00:00.000Z",
      requiredAgreementTermId: null,
    };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await expect(getSessionInfo()).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith("/auth", {
      method: "GET",
      cache: "no-store",
    });
  });

  test("coalesces concurrent session information requests", async () => {
    const payload = {
      userId: "0001000000000001",
      userEmail: "user@stgy.jp",
      userNickname: "user",
      userIsAdmin: false,
      userCreatedAt: "2026-01-01T00:00:00.000Z",
      userUpdatedAt: null,
      userLocale: "ja",
      userTimezone: "Asia/Tokyo",
      loggedInAt: "2026-08-02T00:00:00.000Z",
      requiredAgreementTermId: "19F3FC04CB800000",
    };
    let resolveResponse: ((response: Response) => void) | null = null;
    mockApiFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );

    const first = getSessionInfo();
    const second = getSessionInfo();

    expect(second).toBe(first);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    resolveResponse!(jsonResponse(payload));
    await expect(first).resolves.toEqual(payload);
  });

  test("switches the current session to the selected user", async () => {
    const payload = { sessionId: "new-session" };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await expect(switchLoginAccount("0001000000000001")).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith("/auth/switch-user", {
      method: "POST",
      body: JSON.stringify({ id: "0001000000000001" }),
    });
  });

  test("uses the backend error message", async () => {
    const response = jsonResponse({}, false);
    mockApiFetch.mockResolvedValue(response);
    mockExtractError.mockResolvedValue("user not found");

    await expect(switchLoginAccount("missing")).rejects.toThrow("user not found");
    expect(mockExtractError).toHaveBeenCalledWith(response);
  });
});
