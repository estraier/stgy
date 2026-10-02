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
    metadata = null,
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
    metadata,
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

function tiffAsciiBytes(text) {
  const value = String(text || "").replace(/\0.*$/s, "").trim();
  if (!value) return null;
  const bytes = new Uint8Array(value.length + 1);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

function tiffShortBytes(value) {
  if (!Number.isFinite(value)) return null;
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, Math.max(0, Math.min(0xffff, Math.round(value))), true);
  return bytes;
}

function tiffLongBytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, Math.max(0, Math.round(value)) >>> 0, true);
  return bytes;
}

function tiffRationalBytes(values, signed = false) {
  const list = Array.isArray(values) ? values : [values];
  const bytes = new Uint8Array(list.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < list.length; i += 1) {
    const value = Number(list[i]);
    const denominator = 1_000_000;
    const numerator = Math.round(value * denominator);
    if (signed) {
      view.setInt32(i * 8, numerator, true);
      view.setInt32(i * 8 + 4, denominator, true);
    } else {
      view.setUint32(i * 8, Math.max(0, numerator) >>> 0, true);
      view.setUint32(i * 8 + 4, denominator, true);
    }
  }
  return bytes;
}

function tiffByteBytes(values) {
  return Uint8Array.from(values.map((value) => Math.max(0, Math.min(255, Math.round(value)))));
}

function degreesToDms(value) {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  return [degrees, minutes, seconds];
}

function makeTiffEntry(tag, type, count, bytes) {
  return bytes ? { tag, type, count, bytes, offset: null } : null;
}

function addTiffEntry(entries, entry) {
  if (entry) entries.push(entry);
}

function makeAsciiTiffEntry(tag, value) {
  const bytes = tiffAsciiBytes(value);
  return bytes ? makeTiffEntry(tag, 2, bytes.length, bytes) : null;
}

function makeShortTiffEntry(tag, value) {
  const bytes = tiffShortBytes(value);
  return bytes ? makeTiffEntry(tag, 3, 1, bytes) : null;
}

function makeLongTiffEntry(tag, value) {
  if (!Number.isFinite(value)) return null;
  return makeTiffEntry(tag, 4, 1, tiffLongBytes(value));
}

function makeIsoTiffEntry(tag, value) {
  if (!Number.isFinite(value) || value < 0) return null;
  return value <= 0xffff ? makeShortTiffEntry(tag, value) : makeLongTiffEntry(tag, value);
}

function makeRationalTiffEntry(tag, value, signed = false) {
  if (!Number.isFinite(value)) return null;
  return makeTiffEntry(tag, signed ? 10 : 5, 1, tiffRationalBytes(value, signed));
}

function metadataTiffEntries(metadata) {
  const ifd0 = [];
  const exif = [];
  const gps = [];
  if (!metadata) return { ifd0, exif, gps };

  addTiffEntry(ifd0, makeAsciiTiffEntry(270, metadata.imageDescription));
  addTiffEntry(ifd0, makeAsciiTiffEntry(271, metadata.make));
  addTiffEntry(ifd0, makeAsciiTiffEntry(272, metadata.model));
  addTiffEntry(ifd0, makeAsciiTiffEntry(315, metadata.artist));
  addTiffEntry(ifd0, makeAsciiTiffEntry(33432, metadata.copyright));

  addTiffEntry(exif, makeRationalTiffEntry(33434, metadata.exposureTime));
  addTiffEntry(exif, makeRationalTiffEntry(33437, metadata.fNumber));
  addTiffEntry(exif, makeShortTiffEntry(34850, metadata.exposureProgram));
  addTiffEntry(exif, makeIsoTiffEntry(34855, metadata.iso));
  addTiffEntry(exif, makeAsciiTiffEntry(36867, metadata.dateTimeOriginal));
  addTiffEntry(exif, makeAsciiTiffEntry(36868, metadata.dateTimeDigitized));
  addTiffEntry(exif, makeAsciiTiffEntry(36881, metadata.offsetTimeOriginal));
  addTiffEntry(exif, makeRationalTiffEntry(37380, metadata.exposureBiasValue, true));
  addTiffEntry(exif, makeShortTiffEntry(37383, metadata.meteringMode));
  addTiffEntry(exif, makeShortTiffEntry(37385, metadata.flash));
  addTiffEntry(exif, makeRationalTiffEntry(37386, metadata.focalLength));
  addTiffEntry(exif, makeAsciiTiffEntry(37521, metadata.subSecTimeOriginal));
  addTiffEntry(exif, makeAsciiTiffEntry(42035, metadata.lensMake));
  addTiffEntry(exif, makeAsciiTiffEntry(42036, metadata.lensModel));

  if (metadata.gps && Number.isFinite(metadata.gps.latitude) && Number.isFinite(metadata.gps.longitude)) {
    gps.push(makeTiffEntry(0, 1, 4, tiffByteBytes([2, 3, 0, 0])));
    addTiffEntry(gps, makeAsciiTiffEntry(1, metadata.gps.latitude < 0 ? "S" : "N"));
    gps.push(makeTiffEntry(2, 5, 3, tiffRationalBytes(degreesToDms(metadata.gps.latitude))));
    addTiffEntry(gps, makeAsciiTiffEntry(3, metadata.gps.longitude < 0 ? "W" : "E"));
    gps.push(makeTiffEntry(4, 5, 3, tiffRationalBytes(degreesToDms(metadata.gps.longitude))));
    if (Number.isFinite(metadata.gps.altitude)) {
      gps.push(makeTiffEntry(5, 1, 1, tiffByteBytes([metadata.gps.altitude < 0 ? 1 : 0])));
      gps.push(makeTiffEntry(6, 5, 1, tiffRationalBytes(Math.abs(metadata.gps.altitude))));
    }
  }
  return { ifd0, exif, gps };
}

function ifdTableSize(entries) {
  return 2 + entries.length * 12 + 4;
}

function layoutExternalEntryData(entries, initialCursor) {
  let cursor = initialCursor;
  for (const entry of entries) {
    if (entry.bytes.length <= 4) continue;
    cursor = align4(cursor);
    entry.offset = cursor;
    cursor += entry.bytes.length;
  }
  return cursor;
}

function writeTiffIfd(output, offset, entries) {
  const view = new DataView(output.buffer);
  const sorted = entries.slice().sort((a, b) => a.tag - b.tag);
  view.setUint16(offset, sorted.length, true);
  let entryOffset = offset + 2;
  for (const entry of sorted) {
    view.setUint16(entryOffset, entry.tag, true);
    view.setUint16(entryOffset + 2, entry.type, true);
    view.setUint32(entryOffset + 4, entry.count, true);
    output.fill(0, entryOffset + 8, entryOffset + 12);
    if (entry.bytes.length <= 4) {
      output.set(entry.bytes, entryOffset + 8);
    } else {
      view.setUint32(entryOffset + 8, entry.offset, true);
      output.set(entry.bytes, entry.offset);
    }
    entryOffset += 12;
  }
  view.setUint32(entryOffset, 0, true);
}

function buildClassicTiff(options) {
  const {
    width,
    height,
    bitsPerSample,
    compression,
    stripBytes,
    iccProfile,
    metadata = null,
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
  const metadataEntries = metadataTiffEntries(metadata);

  const ifd0Entries = [
    makeLongTiffEntry(256, width),
    makeLongTiffEntry(257, height),
    makeTiffEntry(258, 3, 3, bitsArray),
    makeShortTiffEntry(259, compression),
    makeShortTiffEntry(262, 2),
    makeLongTiffEntry(273, 0), // filled after layout
    makeShortTiffEntry(274, 1), // output pixels are already upright
    makeShortTiffEntry(277, 3),
    makeLongTiffEntry(278, height),
    makeLongTiffEntry(279, stripBytes.length),
    makeTiffEntry(282, 5, 1, xResolution),
    makeTiffEntry(283, 5, 1, yResolution),
    makeShortTiffEntry(284, 1),
    makeShortTiffEntry(296, 2),
    makeTiffEntry(305, 2, software.length, software),
    makeTiffEntry(339, 3, 3, sampleFormat),
    makeTiffEntry(34675, 7, iccProfile.length, iccProfile),
    ...metadataEntries.ifd0,
  ].filter(Boolean);

  if (metadataEntries.exif.length > 0) ifd0Entries.push(makeLongTiffEntry(34665, 0));
  if (metadataEntries.gps.length > 0) ifd0Entries.push(makeLongTiffEntry(34853, 0));

  const ifdOffset = 8;
  let cursor = align4(ifdOffset + ifdTableSize(ifd0Entries));
  cursor = layoutExternalEntryData(ifd0Entries, cursor);

  const exifIfdOffset = metadataEntries.exif.length > 0 ? align4(cursor) : 0;
  if (metadataEntries.exif.length > 0) {
    cursor = exifIfdOffset + ifdTableSize(metadataEntries.exif);
    cursor = layoutExternalEntryData(metadataEntries.exif, cursor);
  }

  const gpsIfdOffset = metadataEntries.gps.length > 0 ? align4(cursor) : 0;
  if (metadataEntries.gps.length > 0) {
    cursor = gpsIfdOffset + ifdTableSize(metadataEntries.gps);
    cursor = layoutExternalEntryData(metadataEntries.gps, cursor);
  }

  const stripOffset = align4(cursor);
  cursor = stripOffset + stripBytes.length;

  for (const entry of ifd0Entries) {
    if (entry.tag === 273) entry.bytes = tiffLongBytes(stripOffset);
    if (entry.tag === 34665) entry.bytes = tiffLongBytes(exifIfdOffset);
    if (entry.tag === 34853) entry.bytes = tiffLongBytes(gpsIfdOffset);
  }

  const output = new Uint8Array(cursor);
  const view = new DataView(output.buffer);
  output[0] = 0x49;
  output[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  writeTiffIfd(output, ifdOffset, ifd0Entries);
  if (metadataEntries.exif.length > 0) writeTiffIfd(output, exifIfdOffset, metadataEntries.exif);
  if (metadataEntries.gps.length > 0) writeTiffIfd(output, gpsIfdOffset, metadataEntries.gps);
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
