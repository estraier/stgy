import { apiFetch, extractError } from "./client";
import {
  deleteTrack,
  finalizeTrack,
  getTracksMonthlyQuota,
  listTracks,
  presignTrackUpload,
} from "./tracks";

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

describe("track API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("requests a presigned upload", async () => {
    const payload = {
      url: "https://storage.example/upload",
      fields: { key: "tracks-staging/u1/x.fit" },
      objectKey: "tracks-staging/u1/x.fit",
      expiresInSec: 300,
    };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await expect(presignTrackUpload("u 1", "ride.fit", 123)).resolves.toEqual(payload);
    expect(mockApiFetch).toHaveBeenCalledWith("/media/u%201/tracks/presigned", {
      method: "POST",
      body: JSON.stringify({ filename: "ride.fit", sizeBytes: 123 }),
    });
  });

  test("finalizes a staged track", async () => {
    const payload = { master: { key: "u1/masters/a.fit" } };
    mockApiFetch.mockResolvedValue(jsonResponse(payload));

    await finalizeTrack("u1", "tracks-staging/u1/a.fit");
    expect(mockApiFetch).toHaveBeenCalledWith("/media/u1/tracks/finalize", {
      method: "POST",
      body: JSON.stringify({ key: "tracks-staging/u1/a.fit" }),
    });
  });

  test("lists tracks with pagination", async () => {
    mockApiFetch.mockResolvedValue(jsonResponse([]));

    await listTracks("u1", { offset: 30, limit: 31 });
    expect(mockApiFetch).toHaveBeenCalledWith("/media/u1/tracks?offset=30&limit=31", {
      method: "GET",
    });
  });

  test("gets quota for a selected month", async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ yyyymm: "202607" }));

    await getTracksMonthlyQuota("u1", "202607");
    expect(mockApiFetch).toHaveBeenCalledWith("/media/u1/tracks/quota?yyyymm=202607", {
      method: "GET",
    });
  });

  test("encodes each path segment when deleting", async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ result: "ok" }));

    await deleteTrack("u1", "masters/a b/ride.fit");
    expect(mockApiFetch).toHaveBeenCalledWith("/media/u1/tracks/masters/a%20b/ride.fit", {
      method: "DELETE",
    });
  });

  test("uses the backend error message", async () => {
    const response = jsonResponse({}, false);
    mockApiFetch.mockResolvedValue(response);
    mockExtractError.mockResolvedValue("invalid track data");

    await expect(listTracks("u1")).rejects.toThrow("invalid track data");
    expect(mockExtractError).toHaveBeenCalledWith(response);
  });
});
