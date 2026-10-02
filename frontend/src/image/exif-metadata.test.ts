import {
  attachWhitelistedMetadata,
  buildExifTiffPayload,
  extractWhitelistedMetadataFromBuffer,
  extractWhitelistedMetadataFromLibRaw,
  mergeStackMetadata,
  parseExifTiffMetadata,
  type PreservedImageMetadata,
} from "./exif-metadata";
import { encodeFromLinearProPhoto } from "./tiff";

const sampleMetadata: PreservedImageMetadata = {
  dateTimeOriginal: "2026:10:02 12:34:56",
  subSecTimeOriginal: "789",
  offsetTimeOriginal: "+09:00",
  dateTimeDigitized: "2026:10:02 12:34:57",
  make: "Example Camera Co.",
  model: "Example 1",
  lensMake: "Example Lens Co.",
  lensModel: "50mm F1.8",
  focalLength: 50,
  exposureTime: 1 / 250,
  fNumber: 2.8,
  iso: 200,
  exposureBiasValue: -2 / 3,
  meteringMode: 5,
  flash: 16,
  exposureProgram: 3,
  artist: "Photographer",
  copyright: "Copyright 2026",
  imageDescription: "Description",
  gps: { latitude: 36.4012, longitude: 138.2498, altitude: 512.3 },
};

describe("EXIF metadata whitelist", () => {
  test("round-trips the whitelisted fields through a fresh EXIF TIFF payload", () => {
    const payload = buildExifTiffPayload(sampleMetadata);
    expect(payload).not.toBeNull();
    const parsed = parseExifTiffMetadata(payload!);
    expect(parsed).toMatchObject({
      dateTimeOriginal: sampleMetadata.dateTimeOriginal,
      subSecTimeOriginal: sampleMetadata.subSecTimeOriginal,
      offsetTimeOriginal: sampleMetadata.offsetTimeOriginal,
      dateTimeDigitized: sampleMetadata.dateTimeDigitized,
      make: sampleMetadata.make,
      model: sampleMetadata.model,
      lensMake: sampleMetadata.lensMake,
      lensModel: sampleMetadata.lensModel,
      focalLength: 50,
      fNumber: 2.8,
      iso: 200,
      meteringMode: 5,
      flash: 16,
      exposureProgram: 3,
      artist: sampleMetadata.artist,
      copyright: sampleMetadata.copyright,
      imageDescription: sampleMetadata.imageDescription,
    });
    expect(parsed?.exposureTime).toBeCloseTo(1 / 250, 6);
    expect(parsed?.exposureBiasValue).toBeCloseTo(-2 / 3, 6);
    expect(parsed?.gps?.latitude).toBeCloseTo(sampleMetadata.gps!.latitude, 5);
    expect(parsed?.gps?.longitude).toBeCloseTo(sampleMetadata.gps!.longitude, 5);
    expect(parsed?.gps?.altitude).toBeCloseTo(sampleMetadata.gps!.altitude!, 3);
  });


  test("preserves high ISO values without SHORT truncation", () => {
    const metadata = { ...sampleMetadata, iso: 102400 };
    const payload = buildExifTiffPayload(metadata);
    expect(parseExifTiffMetadata(payload!)?.iso).toBe(102400);
  });

  test("maps LibRaw timestamp and parsed GPS into the whitelist", () => {
    const metadata = extractWhitelistedMetadataFromLibRaw({
      timestamp: Date.UTC(2026, 9, 2, 3, 4, 5) / 1000,
      camera_make: "Camera",
      camera_model: "Model",
      parsed_gps: {
        latitude: [36, 24, 4.32],
        longitude: [138, 14, 59.28],
        altitude: 512.3,
        latref: "N",
        longref: "E",
        altref: 0,
        gpsparsed: 1,
      },
    });
    expect(metadata?.dateTimeOriginal).toBe("2026:10:02 03:04:05");
    expect(metadata?.gps?.latitude).toBeCloseTo(36.4012, 5);
    expect(metadata?.gps?.longitude).toBeCloseTo(138.2498, 5);
    expect(metadata?.gps?.altitude).toBeCloseTo(512.3, 3);
  });

  test("selects the earliest capture time and preserves only values shared by every LSS input", () => {
    const merged = mergeStackMetadata([
      {
        dateTimeOriginal: "2026:10:02 12:00:02",
        subSecTimeOriginal: "200",
        offsetTimeOriginal: "+09:00",
        make: "Camera",
        model: "Model",
        lensModel: "Lens",
        focalLength: 50,
        fNumber: 2,
        exposureTime: 1 / 500,
        iso: 200,
        artist: "A",
        gps: { latitude: 36.4, longitude: 138.25, altitude: 500 },
      },
      {
        dateTimeOriginal: "2026:10:02 12:00:01",
        subSecTimeOriginal: "900",
        offsetTimeOriginal: "+09:00",
        make: "Camera",
        model: "Model",
        lensModel: "Lens",
        focalLength: 50,
        fNumber: 2.8,
        exposureTime: 1 / 250,
        iso: 200,
        artist: "A",
        gps: { latitude: 36.400001, longitude: 138.250001, altitude: 500.5 },
      },
    ]);
    expect(merged).toMatchObject({
      dateTimeOriginal: "2026:10:02 12:00:01",
      subSecTimeOriginal: "900",
      offsetTimeOriginal: "+09:00",
      make: "Camera",
      model: "Model",
      lensModel: "Lens",
      focalLength: 50,
      iso: 200,
      artist: "A",
    });
    expect(merged?.fNumber).toBeUndefined();
    expect(merged?.exposureTime).toBeUndefined();
    expect(merged?.gps).toEqual({ latitude: 36.4, longitude: 138.25, altitude: 500 });
  });

  test("injects only a newly-built EXIF block into JPEG output", async () => {
    const jpeg = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
    const output = await attachWhitelistedMetadata(jpeg, sampleMetadata);
    const parsed = extractWhitelistedMetadataFromBuffer(await output.arrayBuffer());
    expect(parsed?.dateTimeOriginal).toBe(sampleMetadata.dateTimeOriginal);
    expect(parsed?.make).toBe(sampleMetadata.make);
    expect(parsed?.lensModel).toBe(sampleMetadata.lensModel);
  });

  test("writes the whitelist into TIFF output without copying source geometry metadata", async () => {
    const encoded = await encodeFromLinearProPhoto({
      data: new Float32Array([0.25, 0.5, 0.75]),
      width: 1,
      height: 1,
      bitsPerSample: 16,
      outputColorSpace: "srgb",
      preferDeflate: false,
      metadata: sampleMetadata,
    });
    const parsed = extractWhitelistedMetadataFromBuffer(await encoded.blob.arrayBuffer());
    expect(parsed?.dateTimeOriginal).toBe(sampleMetadata.dateTimeOriginal);
    expect(parsed?.make).toBe(sampleMetadata.make);
    expect(parsed?.fNumber).toBeCloseTo(2.8, 6);
    expect(parsed?.gps?.latitude).toBeCloseTo(sampleMetadata.gps!.latitude, 5);
  });
});
