import { apiFetch, extractError } from "./client";
import { makeQueryHashHeaders } from "@/utils/queryHash";
import {
  approvePubComment,
  createPubComment,
  deletePubComment,
  editAuthorPubComment,
  getPubCommentFormState,
  listPubComments,
} from "./pubComments";

jest.mock("./client", () => ({
  apiFetch: jest.fn(),
  extractError: jest.fn(),
}));

jest.mock("@/utils/queryHash", () => ({
  makeQueryHashHeaders: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockExtractError = extractError as jest.MockedFunction<typeof extractError>;
const mockMakeQueryHashHeaders = makeQueryHashHeaders as jest.MockedFunction<
  typeof makeQueryHashHeaders
>;

function jsonResponse(value: unknown, ok = true): Response {
  return {
    ok,
    json: jest.fn().mockResolvedValue(value),
  } as unknown as Response;
}

describe("pub comments API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMakeQueryHashHeaders.mockResolvedValue({ "X-STGY-QueryHash": "hash" });
  });

  test("lists public comments with page and order", async () => {
    const payload = { comments: [], page: 2, hasPrevious: true, hasNext: false, limitReached: false };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await expect(
      listPubComments({ postId: "0000000000000001", page: 2, order: "oldest" }),
    ).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/pub-comments?postId=0000000000000001&page=2&order=oldest",
      { method: "GET" },
    );
  });

  test("gets form state", async () => {
    const payload = {
      captchaRequired: false,
      nickname: "太郎",
      canPostAsAuthor: true,
      asAuthor: false,
      canPost: true,
      limitReached: false,
    };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));
    await expect(getPubCommentFormState("0000000000000001")).resolves.toEqual(payload);
  });

  test("creates a comment with query-hash header", async () => {
    const input = {
      postId: "0000000000000001",
      nickname: "太郎",
      body: "hello",
      asAuthor: false,
      captchaId: "challenge",
      captchaAnswer: "123456",
    };
    const comment = { id: "0000000000000002" };
    mockApiFetch.mockResolvedValue(jsonResponse({ comment }));

    await expect(createPubComment(input)).resolves.toEqual({ comment });
    expect(mockMakeQueryHashHeaders).toHaveBeenCalledWith(expect.any(URLSearchParams));
    expect(mockApiFetch).toHaveBeenCalledWith("/pub-comments", {
      method: "POST",
      headers: { "X-STGY-QueryHash": "hash" },
      body: JSON.stringify(input),
    });
  });

  test("approves, edits, and deletes comments", async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse({ id: "C" }))
      .mockResolvedValueOnce(jsonResponse({ id: "C", name: "new" }))
      .mockResolvedValueOnce(jsonResponse({ result: "ok" }));

    await approvePubComment("C");
    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/pub-comments/C", {
      method: "PATCH",
      body: JSON.stringify({ status: "published" }),
    });

    await editAuthorPubComment("C", { nickname: "new", body: "body" });
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/pub-comments/C", {
      method: "PATCH",
      body: JSON.stringify({ nickname: "new", body: "body" }),
    });

    await deletePubComment("C");
    expect(mockApiFetch).toHaveBeenNthCalledWith(3, "/pub-comments/C", { method: "DELETE" });
  });

  test("propagates backend errors", async () => {
    const response = jsonResponse({}, false);
    mockApiFetch.mockResolvedValue(response);
    mockExtractError.mockResolvedValue("captcha required");
    await expect(
      createPubComment({ postId: "P", nickname: "n", body: "b", asAuthor: false }),
    ).rejects.toThrow("captcha required");
    expect(mockExtractError).toHaveBeenCalledWith(response);
  });
});
