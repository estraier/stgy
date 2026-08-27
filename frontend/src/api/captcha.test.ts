import { apiFetch, extractError } from "./client";
import {
  createCaptchaChallenge,
  getCaptchaStatus,
  resetCaptchaPass,
  verifyCaptchaChallenge,
} from "./captcha";

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

describe("captcha API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("gets pass status", async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ valid: true, used: 3, remaining: 97 }));
    await expect(getCaptchaStatus()).resolves.toEqual({ valid: true, used: 3, remaining: 97 });
    expect(mockApiFetch).toHaveBeenCalledWith("/captcha/status", { method: "GET" });
  });

  test("creates a challenge", async () => {
    const payload = { challengeId: "abc", image: "data:image/png;base64,AA==" };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));
    await expect(createCaptchaChallenge()).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith("/captcha/challenge", { method: "POST" });
  });

  test("verifies a challenge", async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ passed: true, remaining: 100 }));
    await expect(verifyCaptchaChallenge("challenge", "482731")).resolves.toEqual({
      passed: true,
      remaining: 100,
    });
    expect(mockApiFetch).toHaveBeenCalledWith("/captcha/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId: "challenge", answer: "482731" }),
    });
  });

  test("resets a pass token", async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ result: "ok" }));
    await expect(resetCaptchaPass()).resolves.toBeUndefined();
    expect(mockApiFetch).toHaveBeenCalledWith("/captcha/pass", { method: "DELETE" });
  });

  test("propagates backend errors", async () => {
    const response = jsonResponse({}, false);
    mockApiFetch.mockResolvedValue(response);
    mockExtractError.mockResolvedValue("invalid captcha");
    await expect(verifyCaptchaChallenge("challenge", "000000")).rejects.toThrow("invalid captcha");
    expect(mockExtractError).toHaveBeenCalledWith(response);
  });
});
