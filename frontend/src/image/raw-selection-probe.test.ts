import { buildExifTiffPayload, probeRawImageSizeAndMetadata } from "./exif-metadata";
import { createLibRawInstance, createLibRawWorkerFailure } from "./libraw";

jest.mock("./libraw", () => {
  const original = jest.requireActual<typeof import("./libraw")>("./libraw");
  return {
    ...original,
    createLibRawInstance: jest.fn(),
    createLibRawWorkerFailure: jest.fn(() => ({
      promise: new Promise<never>(() => {}),
      cleanup: jest.fn(),
    })),
  };
});

const mockedCreate = jest.mocked(createLibRawInstance);
const mockedWorkerFailure = jest.mocked(createLibRawWorkerFailure);

function setupRaw(fullMetadata: Record<string, unknown> = {}) {
  const open = jest.fn(async (_bytes: BufferSource) => {});
  const metadata = jest.fn(async (fullOutput?: boolean) => fullOutput
    ? fullMetadata
    : { width: 4032, height: 3024 });
  const dispose = jest.fn();
  mockedCreate.mockResolvedValue({ open, metadata, imageData: jest.fn(), dispose });
  return { open, metadata, dispose };
}

describe("LIS RAW single-open selection probe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("reads bytes once, opens LibRaw once, and preserves dimension/full-metadata modes", async () => {
    const raw = setupRaw({ camera_make: "Maker", iso_speed: 400, aperture: 2.8 });
    const file = new File([new Uint8Array([1, 2, 3, 4]) as unknown as BlobPart], "sample.arw");
    const readBytes = jest.spyOn(file, "arrayBuffer");
    const result = await probeRawImageSizeAndMetadata(file);
    expect(readBytes).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(raw.open).toHaveBeenCalledTimes(1);
    expect(Array.from(new Uint8Array(raw.open.mock.calls[0][0] as Uint8Array))).toEqual([1, 2, 3, 4]);
    expect(raw.metadata.mock.calls.map(([fullOutput]) => fullOutput)).toEqual([false, true]);
    expect(result).toEqual({ width: 4032, height: 3024, metadata: {
      make: "Maker", iso: 400, fNumber: 2.8,
    } });
    expect(raw.dispose).toHaveBeenCalledTimes(1);
    expect(mockedWorkerFailure.mock.results[0].value.cleanup).toHaveBeenCalledTimes(1);
  });

  test("retains embedded EXIF priority over LibRaw's full metadata", async () => {
    const payload = buildExifTiffPayload({ make: "Embedded", model: "EXIF body", iso: 200 });
    expect(payload).not.toBeNull();
    const raw = setupRaw({ camera_make: "Fallback", iso_speed: 400, focal_len: 35 });
    const file = new File([payload! as unknown as BlobPart], "sample.dng");
    const result = await probeRawImageSizeAndMetadata(file);
    expect(result.metadata).toMatchObject({ make: "Embedded", model: "EXIF body", iso: 200, focalLength: 35 });
    expect(raw.open).toHaveBeenCalledTimes(1);
  });

  test("keeps embedded EXIF if optional full metadata fails", async () => {
    const payload = buildExifTiffPayload({ make: "Embedded", fNumber: 4 });
    const raw = setupRaw();
    raw.metadata.mockImplementation(async (fullOutput?: boolean) => {
      if (fullOutput) throw new Error("full metadata failed");
      return { width: 4032, height: 3024 };
    });
    const result = await probeRawImageSizeAndMetadata(new File([payload! as unknown as BlobPart], "sample.nef"));
    expect(result.metadata).toMatchObject({ make: "Embedded", fNumber: 4 });
    expect(raw.dispose).toHaveBeenCalledTimes(1);
  });

  test("dimension probe failure propagates without leaking the decoder", async () => {
    const raw = setupRaw();
    raw.metadata.mockRejectedValue(new Error("metadata failed"));
    await expect(probeRawImageSizeAndMetadata(new File(["x"], "sample.arw")))
      .rejects.toThrow("RAW metadata probe failed: metadata failed");
    expect(raw.dispose).toHaveBeenCalledTimes(1);
  });
});
