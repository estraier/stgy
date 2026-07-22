import { apiFetch, extractError } from "./client";
import { switchLoginAccount } from "./auth";

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
