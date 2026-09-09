// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// High-bit-depth TIFF encoder shared by browser image tools.
const D50_TO_D65 = [
  0.9554734, -0.0230985, 0.0632593,
  -0.0283697, 1.0099956, 0.0210414,
  0.0123140, -0.0205077, 1.3303659,
];
const PROPHOTO_TO_XYZ_D50 = [
  0.7976749, 0.1351917, 0.0313534,
  0.2880402, 0.7118741, 0.0000857,
  0.0, 0.0, 0.8252100,
];
const XYZ_D65_TO_SRGB = [
  3.24096994, -1.53738318, -0.49861076,
  -0.96924364, 1.8759675, 0.04155506,
  0.05563008, -0.20397696, 1.05697151,
];
const XYZ_D65_TO_DISPLAY_P3 = [
  2.493496911941425, -0.9313836179191239, -0.40271078445071684,
  -0.8294889695615747, 1.7626640603183463, 0.023624685841943577,
  0.03584583024378447, -0.07617238926804182, 0.9568845240076872,
];

const D65_TO_D50 = [
  1.0479298, 0.0229468, -0.0501922,
  0.0296278, 0.9904345, -0.0170738,
  -0.0092430, 0.0150552, 0.7518743,
];
const SRGB_TO_XYZ_D65 = [
  0.4123908, 0.35758434, 0.18048079,
  0.21263901, 0.71516868, 0.07219232,
  0.01933082, 0.11919478, 0.95053215,
];
const DISPLAY_P3_TO_XYZ_D65 = [
  0.48657095, 0.26566769, 0.19821729,
  0.22897456, 0.69173852, 0.07928691,
  0.0, 0.04511338, 1.04394437,
];

export async function encodeFromLinearProPhoto(options) {
  const {
    data,
    width,
    height,
    bitsPerSample,
    outputColorSpace,
    preferDeflate = true,
  } = options;

  if (!(data instanceof Float32Array)) {
    throw new Error("TIFF encoder requires a Float32Array linear ProPhoto RGB buffer.");
  }
  if (!(width > 0 && height > 0 && data.length === width * height * 3)) {
    throw new Error("TIFF encoder received an invalid image size or buffer length.");
  }
  if (bitsPerSample !== 8 && bitsPerSample !== 16) {
    throw new Error(`Unsupported TIFF bit depth: ${bitsPerSample}`);
  }
  if (outputColorSpace !== "srgb" && outputColorSpace !== "display-p3") {
    throw new Error(`Unsupported TIFF color space: ${outputColorSpace}`);
  }

  const raw = encodeRgbSamples(data, bitsPerSample, outputColorSpace);
  let stripBytes = raw;
  let compression = 1;

  if (preferDeflate && typeof CompressionStream === "function") {
    try {
      stripBytes = await deflate(raw);
      compression = 8;
    } catch (error) {
      console.warn("TIFF Deflate compression failed; falling back to uncompressed TIFF.", error);
      stripBytes = raw;
      compression = 1;
    }
  }

  const iccProfile = buildRgbIccProfile(outputColorSpace);
  const tiffBytes = buildClassicTiff({
    width,
    height,
    bitsPerSample,
    compression,
    stripBytes,
    iccProfile,
  });

  return {
    blob: new Blob([tiffBytes], { type: "image/tiff" }),
    compression: compression === 8 ? "deflate" : "none",
    colorSpace: outputColorSpace,
    bitsPerSample,
  };
}

function encodeRgbSamples(data, bitsPerSample, outputColorSpace) {
  const bytesPerSample = bitsPerSample / 8;
  const output = new Uint8Array((data.length) * bytesPerSample);
  const view = new DataView(output.buffer);
  let byteOffset = 0;

  for (let i = 0; i < data.length; i += 3) {
    const encoded = proPhotoLinearToOutputUnit(
      data[i],
      data[i + 1],
      data[i + 2],
      outputColorSpace,
    );
    if (bitsPerSample === 8) {
      output[byteOffset++] = Math.round(encoded[0] * 255);
      output[byteOffset++] = Math.round(encoded[1] * 255);
      output[byteOffset++] = Math.round(encoded[2] * 255);
    } else {
      view.setUint16(byteOffset, Math.round(encoded[0] * 65535), true);
      byteOffset += 2;
      view.setUint16(byteOffset, Math.round(encoded[1] * 65535), true);
      byteOffset += 2;
      view.setUint16(byteOffset, Math.round(encoded[2] * 65535), true);
      byteOffset += 2;
    }
  }

  return output;
}

function proPhotoLinearToOutputUnit(r, g, b, outputColorSpace) {
  const x50 = PROPHOTO_TO_XYZ_D50[0] * r + PROPHOTO_TO_XYZ_D50[1] * g + PROPHOTO_TO_XYZ_D50[2] * b;
  const y50 = PROPHOTO_TO_XYZ_D50[3] * r + PROPHOTO_TO_XYZ_D50[4] * g + PROPHOTO_TO_XYZ_D50[5] * b;
  const z50 = PROPHOTO_TO_XYZ_D50[6] * r + PROPHOTO_TO_XYZ_D50[7] * g + PROPHOTO_TO_XYZ_D50[8] * b;

  const x65 = D50_TO_D65[0] * x50 + D50_TO_D65[1] * y50 + D50_TO_D65[2] * z50;
  const y65 = D50_TO_D65[3] * x50 + D50_TO_D65[4] * y50 + D50_TO_D65[5] * z50;
  const z65 = D50_TO_D65[6] * x50 + D50_TO_D65[7] * y50 + D50_TO_D65[8] * z50;

  const matrix = outputColorSpace === "display-p3" ? XYZ_D65_TO_DISPLAY_P3 : XYZ_D65_TO_SRGB;
  const lr = matrix[0] * x65 + matrix[1] * y65 + matrix[2] * z65;
  const lg = matrix[3] * x65 + matrix[4] * y65 + matrix[5] * z65;
  const lb = matrix[6] * x65 + matrix[7] * y65 + matrix[8] * z65;

  return [encodeSrgbUnit(lr), encodeSrgbUnit(lg), encodeSrgbUnit(lb)];
}

function encodeSrgbUnit(linear) {
  const x = clamp01(linear);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function clamp01(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function buildClassicTiff(options) {
  const {
    width,
    height,
    bitsPerSample,
    compression,
    stripBytes,
    iccProfile,
  } = options;

  const software = asciiBytes("Local Stack Studio\0");
  const bitsArray = new Uint8Array(6);
  const bitsView = new DataView(bitsArray.buffer);
  bitsView.setUint16(0, bitsPerSample, true);
  bitsView.setUint16(2, bitsPerSample, true);
  bitsView.setUint16(4, bitsPerSample, true);

  const sampleFormat = new Uint8Array(6);
  const sampleFormatView = new DataView(sampleFormat.buffer);
  sampleFormatView.setUint16(0, 1, true);
  sampleFormatView.setUint16(2, 1, true);
  sampleFormatView.setUint16(4, 1, true);

  const xResolution = rationalBytes(72, 1);
  const yResolution = rationalBytes(72, 1);

  const entryCount = 17;
  const ifdOffset = 8;
  const ifdSize = 2 + entryCount * 12 + 4;
  let cursor = align4(ifdOffset + ifdSize);

  const bitsOffset = cursor;
  cursor = align4(cursor + bitsArray.length);
  const sampleFormatOffset = cursor;
  cursor = align4(cursor + sampleFormat.length);
  const xResolutionOffset = cursor;
  cursor = align4(cursor + xResolution.length);
  const yResolutionOffset = cursor;
  cursor = align4(cursor + yResolution.length);
  const softwareOffset = cursor;
  cursor = align4(cursor + software.length);
  const iccOffset = cursor;
  cursor = align4(cursor + iccProfile.length);
  const stripOffset = cursor;
  cursor += stripBytes.length;

  const output = new Uint8Array(cursor);
  const view = new DataView(output.buffer);

  output[0] = 0x49;
  output[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  view.setUint16(ifdOffset, entryCount, true);
  let entryOffset = ifdOffset + 2;
  const writeEntry = (tag, type, count, valueOrOffset, inlineShort = false) => {
    view.setUint16(entryOffset, tag, true);
    view.setUint16(entryOffset + 2, type, true);
    view.setUint32(entryOffset + 4, count, true);
    if (inlineShort) {
      view.setUint16(entryOffset + 8, valueOrOffset, true);
      view.setUint16(entryOffset + 10, 0, true);
    } else {
      view.setUint32(entryOffset + 8, valueOrOffset, true);
    }
    entryOffset += 12;
  };

  writeEntry(256, 4, 1, width);
  writeEntry(257, 4, 1, height);
  writeEntry(258, 3, 3, bitsOffset);
  writeEntry(259, 3, 1, compression, true);
  writeEntry(262, 3, 1, 2, true);
  writeEntry(273, 4, 1, stripOffset);
  writeEntry(274, 3, 1, 1, true);
  writeEntry(277, 3, 1, 3, true);
  writeEntry(278, 4, 1, height);
  writeEntry(279, 4, 1, stripBytes.length);
  writeEntry(282, 5, 1, xResolutionOffset);
  writeEntry(283, 5, 1, yResolutionOffset);
  writeEntry(284, 3, 1, 1, true);
  writeEntry(296, 3, 1, 2, true);
  writeEntry(305, 2, software.length, software.length <= 4 ? 0 : softwareOffset);
  writeEntry(339, 3, 3, sampleFormatOffset);
  writeEntry(34675, 7, iccProfile.length, iccOffset);
  view.setUint32(ifdOffset + 2 + entryCount * 12, 0, true);

  output.set(bitsArray, bitsOffset);
  output.set(sampleFormat, sampleFormatOffset);
  output.set(xResolution, xResolutionOffset);
  output.set(yResolution, yResolutionOffset);
  output.set(software, softwareOffset);
  output.set(iccProfile, iccOffset);
  output.set(stripBytes, stripOffset);

  return output;
}

function buildRgbIccProfile(colorSpace) {
  const profileName = colorSpace === "display-p3" ? "Display P3" : "sRGB";
  const sourceMatrix = colorSpace === "display-p3" ? DISPLAY_P3_TO_XYZ_D65 : SRGB_TO_XYZ_D65;
  const d50Matrix = multiply3x3(D65_TO_D50, sourceMatrix);

  const desc = makeDescTag(profileName);
  const wtpt = makeXyzTag([0.9642, 1.0, 0.8249]);
  const rXyz = makeXyzTag([d50Matrix[0], d50Matrix[3], d50Matrix[6]]);
  const gXyz = makeXyzTag([d50Matrix[1], d50Matrix[4], d50Matrix[7]]);
  const bXyz = makeXyzTag([d50Matrix[2], d50Matrix[5], d50Matrix[8]]);
  const trc = makeSrgbCurveTag(1024);
  const copyright = makeTextTag("CC0 Local Stack Studio");

  const blocks = [
    ["desc", desc],
    ["wtpt", wtpt],
    ["rXYZ", rXyz],
    ["gXYZ", gXyz],
    ["bXYZ", bXyz],
    ["rTRC", trc],
    ["gTRC", trc],
    ["bTRC", trc],
    ["cprt", copyright],
  ];

  const tagTableSize = 4 + blocks.length * 12;
  let cursor = align4(128 + tagTableSize);
  const uniqueData = [];
  const dataOffsets = new Map();
  for (const [, block] of blocks) {
    if (!dataOffsets.has(block)) {
      dataOffsets.set(block, cursor);
      uniqueData.push(block);
      cursor = align4(cursor + block.length);
    }
  }

  const profile = new Uint8Array(cursor);
  const view = new DataView(profile.buffer);
  view.setUint32(0, profile.length, false);
  writeAscii(profile, 4, "LSS ");
  view.setUint32(8, 0x02100000, false);
  writeAscii(profile, 12, "mntr");
  writeAscii(profile, 16, "RGB ");
  writeAscii(profile, 20, "XYZ ");
  const date = [2026, 9, 8, 0, 0, 0];
  for (let i = 0; i < date.length; i += 1) view.setUint16(24 + i * 2, date[i], false);
  writeAscii(profile, 36, "acsp");
  writeAscii(profile, 40, "APPL");
  view.setUint32(64, 0, false);
  writeS15Fixed16(view, 68, 0.9642);
  writeS15Fixed16(view, 72, 1.0);
  writeS15Fixed16(view, 76, 0.8249);
  writeAscii(profile, 80, "LSS ");

  view.setUint32(128, blocks.length, false);
  let tableOffset = 132;
  for (const [signature, block] of blocks) {
    writeAscii(profile, tableOffset, signature);
    view.setUint32(tableOffset + 4, dataOffsets.get(block), false);
    view.setUint32(tableOffset + 8, block.length, false);
    tableOffset += 12;
  }

  for (const block of uniqueData) {
    profile.set(block, dataOffsets.get(block));
  }

  return profile;
}

function makeDescTag(text) {
  const ascii = asciiBytes(`${text}\0`);
  const length = 12 + ascii.length + 4 + 4 + 2 + 1 + 67;
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  writeAscii(output, 0, "desc");
  view.setUint32(8, ascii.length, false);
  output.set(ascii, 12);
  let offset = 12 + ascii.length;
  view.setUint32(offset, 0, false);
  offset += 4;
  view.setUint32(offset, 0, false);
  offset += 4;
  view.setUint16(offset, 0, false);
  offset += 2;
  output[offset] = 0;
  return output;
}

function makeTextTag(text) {
  const ascii = asciiBytes(`${text}\0`);
  const output = new Uint8Array(8 + ascii.length);
  writeAscii(output, 0, "text");
  output.set(ascii, 8);
  return output;
}

function makeXyzTag(xyz) {
  const output = new Uint8Array(20);
  const view = new DataView(output.buffer);
  writeAscii(output, 0, "XYZ ");
  writeS15Fixed16(view, 8, xyz[0]);
  writeS15Fixed16(view, 12, xyz[1]);
  writeS15Fixed16(view, 16, xyz[2]);
  return output;
}

function makeSrgbCurveTag(sampleCount) {
  const output = new Uint8Array(12 + sampleCount * 2);
  const view = new DataView(output.buffer);
  writeAscii(output, 0, "curv");
  view.setUint32(8, sampleCount, false);
  for (let i = 0; i < sampleCount; i += 1) {
    const encoded = i / (sampleCount - 1);
    const linear = encoded <= 0.04045 ? encoded / 12.92 : Math.pow((encoded + 0.055) / 1.055, 2.4);
    view.setUint16(12 + i * 2, Math.round(linear * 65535), false);
  }
  return output;
}

function multiply3x3(a, b) {
  const result = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      result[row * 3 + col] =
        a[row * 3] * b[col] +
        a[row * 3 + 1] * b[3 + col] +
        a[row * 3 + 2] * b[6 + col];
    }
  }
  return result;
}

function rationalBytes(numerator, denominator) {
  const output = new Uint8Array(8);
  const view = new DataView(output.buffer);
  view.setUint32(0, numerator, true);
  view.setUint32(4, denominator, true);
  return output;
}

function asciiBytes(text) {
  const output = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) output[i] = text.charCodeAt(i) & 0xff;
  return output;
}

function writeAscii(bytes, offset, text) {
  for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i) & 0xff;
}

function writeS15Fixed16(view, offset, value) {
  view.setInt32(offset, Math.round(value * 65536), false);
}

function align4(value) {
  return (value + 3) & ~3;
}
