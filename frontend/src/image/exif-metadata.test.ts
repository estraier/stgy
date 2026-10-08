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


function concatTestBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function be16(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff]);
}

function be32(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function isoBox(type: string, payload: Uint8Array): Uint8Array {
  return concatTestBytes(be32(payload.length + 8), ascii(type), payload);
}

function buildTestHeif(exifTiff: Uint8Array, constructionMethod: 0 | 1): Uint8Array {
  const exifItem = concatTestBytes(be32(0), exifTiff);
  const infe = isoBox("infe", concatTestBytes(
    Uint8Array.from([2, 0, 0, 0]),
    be16(1),
    be16(0),
    ascii("Exif"),
    Uint8Array.from([0]),
  ));
  const iinf = isoBox("iinf", concatTestBytes(
    Uint8Array.from([0, 0, 0, 0]),
    be16(1),
    infe,
  ));
  const ftyp = isoBox("ftyp", concatTestBytes(ascii("heic"), be32(0), ascii("mif1"), ascii("heic")));

  const makeIloc = (extentOffset: number) => isoBox("iloc", concatTestBytes(
    Uint8Array.from([1, 0, 0, 0]),
    Uint8Array.from([0x44, 0x00]),
    be16(1),
    be16(1),
    be16(constructionMethod),
    be16(0),
    be16(1),
    be32(extentOffset),
    be32(exifItem.length),
  ));

  if (constructionMethod === 1) {
    const iloc = makeIloc(0);
    const idat = isoBox("idat", exifItem);
    const meta = isoBox("meta", concatTestBytes(Uint8Array.from([0, 0, 0, 0]), iinf, iloc, idat));
    return concatTestBytes(ftyp, meta);
  }

  const placeholderIloc = makeIloc(0);
  const placeholderMeta = isoBox("meta", concatTestBytes(Uint8Array.from([0, 0, 0, 0]), iinf, placeholderIloc));
  const mdatDataOffset = ftyp.length + placeholderMeta.length + 8;
  const iloc = makeIloc(mdatDataOffset);
  const meta = isoBox("meta", concatTestBytes(Uint8Array.from([0, 0, 0, 0]), iinf, iloc));
  return concatTestBytes(ftyp, meta, isoBox("mdat", exifItem));
}

function minimalPng(): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = concatTestBytes(be32(13), ascii("IHDR"), Uint8Array.from([
    0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0,
  ]), be32(0));
  const iend = concatTestBytes(be32(0), ascii("IEND"), be32(0));
  return concatTestBytes(signature, ihdr, iend);
}

function minimalWebP(): Uint8Array {
  const vp8lPayload = Uint8Array.from([0x2f, 0, 0, 0, 0]);
  const chunk = concatTestBytes(ascii("VP8L"), Uint8Array.from([5, 0, 0, 0]), vp8lPayload, Uint8Array.from([0]));
  return concatTestBytes(ascii("RIFF"), Uint8Array.from([18, 0, 0, 0]), ascii("WEBP"), chunk);
}

function findWebPChunkPayload(bytes: Uint8Array, wantedType: string): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) return null;
    if (type === wantedType) return bytes.subarray(start, start + length);
    offset = start + length + (length & 1);
  }
  return null;
}

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

  test("reads exposure metadata stored directly in TIFF IFD0", () => {
    const payload = new Uint8Array(66);
    const view = new DataView(payload.buffer);
    payload[0] = 0x49;
    payload[1] = 0x49;
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, 3, true);

    const writeEntry = (offset: number, tag: number, type: number, count: number, value: number) => {
      view.setUint16(offset, tag, true);
      view.setUint16(offset + 2, type, true);
      view.setUint32(offset + 4, count, true);
      view.setUint32(offset + 8, value, true);
    };
    writeEntry(10, 0x829a, 5, 1, 50);
    writeEntry(22, 0x829d, 5, 1, 58);
    writeEntry(34, 0x8827, 3, 1, 400);
    view.setUint32(46, 0, true);
    view.setUint32(50, 1, true);
    view.setUint32(54, 250, true);
    view.setUint32(58, 28, true);
    view.setUint32(62, 10, true);

    const parsed = parseExifTiffMetadata(payload);
    expect(parsed?.exposureTime).toBeCloseTo(1 / 250, 6);
    expect(parsed?.fNumber).toBeCloseTo(2.8, 6);
    expect(parsed?.iso).toBe(400);
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

  test("maps the Date timestamp returned by libraw-wasm 1.6.0 without multiplying milliseconds twice", () => {
    const metadata = extractWhitelistedMetadataFromLibRaw({
      timestamp: new Date(Date.UTC(2026, 7, 26, 9, 33, 20)),
      camera_make: "Olympus",
      camera_model: "E-M5 Mark III",
    });
    expect(metadata?.dateTimeOriginal).toBe("2026:08:26 09:33:20");
  });

  test("accepts an epoch-millisecond LibRaw timestamp for wrapper compatibility", () => {
    const metadata = extractWhitelistedMetadataFromLibRaw({
      timestamp: Date.UTC(2026, 7, 26, 9, 33, 20),
    });
    expect(metadata?.dateTimeOriginal).toBe("2026:08:26 09:33:20");
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

  test.each([0, 1] as const)("reads HEIF EXIF item using construction method %i", (constructionMethod) => {
    const payload = buildExifTiffPayload(sampleMetadata);
    expect(payload).not.toBeNull();
    const heif = buildTestHeif(payload!, constructionMethod);
    const parsed = extractWhitelistedMetadataFromBuffer(heif);
    expect(parsed?.dateTimeOriginal).toBe(sampleMetadata.dateTimeOriginal);
    expect(parsed?.make).toBe(sampleMetadata.make);
    expect(parsed?.lensModel).toBe(sampleMetadata.lensModel);
    expect(parsed?.exposureTime).toBeCloseTo(sampleMetadata.exposureTime!, 6);
    expect(parsed?.fNumber).toBeCloseTo(sampleMetadata.fNumber!, 6);
    expect(parsed?.iso).toBe(sampleMetadata.iso);
    expect(parsed?.gps?.latitude).toBeCloseTo(sampleMetadata.gps!.latitude, 5);
  });

  test("round-trips the whitelist through PNG eXIf output", async () => {
    const png = new Blob([minimalPng()], { type: "image/png" });
    const output = await attachWhitelistedMetadata(png, sampleMetadata);
    const parsed = extractWhitelistedMetadataFromBuffer(await output.arrayBuffer());
    expect(parsed?.dateTimeOriginal).toBe(sampleMetadata.dateTimeOriginal);
    expect(parsed?.make).toBe(sampleMetadata.make);
    expect(parsed?.fNumber).toBeCloseTo(sampleMetadata.fNumber!, 6);
  });

  test("round-trips the whitelist through WebP EXIF output using a TIFF header directly", async () => {
    const webp = new Blob([minimalWebP()], { type: "image/webp" });
    const output = await attachWhitelistedMetadata(webp, sampleMetadata);
    const outputBytes = new Uint8Array(await output.arrayBuffer());
    const exifPayload = findWebPChunkPayload(outputBytes, "EXIF");
    expect(exifPayload).not.toBeNull();
    expect(Array.from(exifPayload!.subarray(0, 4))).toEqual([0x49, 0x49, 0x2a, 0x00]);
    expect(String.fromCharCode(...exifPayload!.subarray(0, 6))).not.toBe("Exif\0\0");

    const parsed = extractWhitelistedMetadataFromBuffer(outputBytes);
    expect(parsed?.dateTimeOriginal).toBe(sampleMetadata.dateTimeOriginal);
    expect(parsed?.make).toBe(sampleMetadata.make);
    expect(parsed?.fNumber).toBeCloseTo(sampleMetadata.fNumber!, 6);
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
