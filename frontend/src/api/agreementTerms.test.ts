import { apiFetch, extractError } from "./client";
import {
  agreeToAgreementTerm,
  getAgreementTerm,
  getLatestAgreementTerm,
} from "./agreementTerms";

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

describe("agreement terms API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("gets the latest agreement term", async () => {
    const payload = {
      id: "19F3FC04CB800000",
      contents: [{ locale: "en", text: "Terms" }],
    };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await expect(getLatestAgreementTerm()).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith("/agreement-terms/latest", {
      method: "GET",
      cache: "no-store",
    });
  });

  test("gets a specified agreement term", async () => {
    const payload = {
      id: "19F3FC04CB800000",
      contents: [{ locale: "ja", text: "規約" }],
    };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await expect(getAgreementTerm(payload.id)).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/agreement-terms/19F3FC04CB800000",
      { method: "GET", cache: "no-store" },
    );
  });

  test("agrees to the specified agreement term", async () => {
    const payload = { result: "ok" };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await expect(agreeToAgreementTerm("19F3FC04CB800000")).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/users/agreement/19F3FC04CB800000",
      { method: "POST" },
    );
  });

  test("preserves the response status on errors", async () => {
    const response = jsonResponse({}, false, 409);
    mockApiFetch.mockResolvedValue(response);
    mockExtractError.mockResolvedValue("agreement term is not latest");

    await expect(agreeToAgreementTerm("OLD")).rejects.toMatchObject({
      name: "AgreementTermsApiError",
      status: 409,
      message: "agreement term is not latest",
    });
    expect(mockExtractError).toHaveBeenCalledWith(response);
  });
});
