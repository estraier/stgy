// Non-RAW input decoding for Local Stack Studio. This module runs entirely in a
// dedicated Worker: no DOM canvas and no full-resolution image transfer.
import * as UTIF from "utif";
import {
  createRgb8ToLinearProphotoConverter,
  encodedRgbToLinearProphotoInto,
} from "@/image/color";

type TiffTags = {
  width?: number;
  height?: number;
  t256?: number[];
  t257?: number[];
  t258?: number[];
  t277?: number[];
  t262?: number[];
  t284?: number[];
  t339?: number[];
  data?: ArrayBuffer | ArrayBufferView;
};

export type CanonicalDecodedImage = {
  width: number;
  height: number;
  linear: Float32Array;
};

function getTiffDimensions(ifd: TiffTags): { width: number; height: number } {
  return {
    width: Math.max(0, Math.round(Number(ifd.width) || Number(ifd.t256?.[0]) || 0)),
    height: Math.max(0, Math.round(Number(ifd.height) || Number(ifd.t257?.[0]) || 0)),
  };
}

function tiffDecodedByteView(data: TiffTags["data"]): ArrayBufferView | null {
  if (ArrayBuffer.isView(data)) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

function decodeTiff16RgbToLinearProPhoto(
  buffer: ArrayBuffer,
  ifd: TiffTags,
  sourceColorSpace: string,
): Float32Array | null {
  const bitsPerSample = Array.isArray(ifd.t258) ? ifd.t258 : [];
  const samplesPerPixel = Number(ifd.t277?.[0] ?? bitsPerSample.length);
  const photometric = Number(ifd.t262?.[0] ?? -1);
  const planarConfiguration = Number(ifd.t284?.[0] ?? 1);
  const sampleFormat = Array.isArray(ifd.t339) && ifd.t339.length > 0 ? ifd.t339 : [1];
  if (
    photometric !== 2 || planarConfiguration !== 1 || samplesPerPixel < 3 ||
    bitsPerSample.length < 3 || bitsPerSample[0] !== 16 ||
    bitsPerSample[1] !== 16 || bitsPerSample[2] !== 16 ||
    sampleFormat.some((value) => Number(value) !== 1)
  ) return null;

  const { width, height } = getTiffDimensions(ifd);
  if (!(width > 0 && height > 0)) return null;
  const raw = tiffDecodedByteView(ifd.data);
  const bytesPerPixel = samplesPerPixel * 2;
  if (!raw || raw.byteLength < width * height * bytesPerPixel) return null;

  const fileBytes = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  const littleEndian = fileBytes.length >= 2 && fileBytes[0] === 0x49 && fileBytes[1] === 0x49;
  const bigEndian = fileBytes.length >= 2 && fileBytes[0] === 0x4d && fileBytes[1] === 0x4d;
  if (!littleEndian && !bigEndian) return null;

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const linear = new Float32Array(width * height * 3);
  const converted = new Float32Array(3);
  let sourceOffset = 0;
  let outputOffset = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const er = view.getUint16(sourceOffset, littleEndian) / 65535;
    const eg = view.getUint16(sourceOffset + 2, littleEndian) / 65535;
    const eb = view.getUint16(sourceOffset + 4, littleEndian) / 65535;
    sourceOffset += bytesPerPixel;
    encodedRgbToLinearProphotoInto(er, eg, eb, sourceColorSpace, converted);
    linear[outputOffset] = converted[0];
    linear[outputOffset + 1] = converted[1];
    linear[outputOffset + 2] = converted[2];
    outputOffset += 3;
  }
  return linear;
}

function rgbaToLinearProPhoto(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  sourceColorSpace: string,
): Float32Array {
  const pixelCount = width * height;
  if (rgba.length < pixelCount * 4) throw new Error("Decoded input has an incomplete RGBA buffer.");
  const linear = new Float32Array(pixelCount * 3);
  const convert = createRgb8ToLinearProphotoConverter(sourceColorSpace);
  const converted = new Float32Array(3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const source = pixel * 4;
    const target = pixel * 3;
    convert(rgba[source], rgba[source + 1], rgba[source + 2], converted);
    linear[target] = converted[0];
    linear[target + 1] = converted[1];
    linear[target + 2] = converted[2];
  }
  return linear;
}

export async function decodeCanonicalNonRawImage(
  file: File,
  sourceColorSpace: string,
): Promise<CanonicalDecodedImage> {
  const lowerName = file.name.toLowerCase();
  if (/^image\/tiff$/i.test(file.type) || /\.(tif|tiff)$/i.test(lowerName)) {
    const buffer = await file.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    if (!ifds || ifds.length === 0) throw new Error(`Failed to parse TIFF structure from ${file.name}.`);
    const ifd = ifds[0];
    UTIF.decodeImage(buffer, ifd);
    const { width, height } = getTiffDimensions(ifd as TiffTags);
    if (!(width > 0 && height > 0)) throw new Error(`Could not determine TIFF dimensions for ${file.name}.`);
    const linear = decodeTiff16RgbToLinearProPhoto(buffer, ifd as TiffTags, sourceColorSpace)
      ?? rgbaToLinearProPhoto(UTIF.toRGBA8(ifd), width, height, sourceColorSpace);
    return { width, height, linear };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      colorSpaceConversion: "none",
    });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Failed to decode ${file.name}${detail}`);
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not create a 2D canvas context.");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: bitmap.width,
      height: bitmap.height,
      linear: rgbaToLinearProPhoto(pixels.data, bitmap.width, bitmap.height, sourceColorSpace),
    };
  } finally {
    bitmap.close();
  }
}
