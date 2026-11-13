/** Bit-identical 4MP RGB16 -> Gray8 preprocessing shared by STF pair workers.
 * Keep the pixel-center bilinear sampling and round/clamp order in sync with
 * the standalone Optical Flow implementation; changing it alters Flow quality.
 */
export const STF_FLOW_TARGET_PIXELS = 4_000_000;

export function stfFlowWorkingSize(width: number, height: number, targetPixels = STF_FLOW_TARGET_PIXELS): { width: number; height: number } {
  const pixels = width * height;
  if (!(pixels > 0) || pixels <= targetPixels) return { width, height };
  const scale = Math.sqrt(targetPixels / pixels);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function clampByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return value;
}
function rgb16ToGray8(r: number, g: number, b: number, encodingScale: number): number {
  const nr = Math.min(65535, Math.round(r * encodingScale));
  const ng = Math.min(65535, Math.round(g * encodingScale));
  const nb = Math.min(65535, Math.round(b * encodingScale));
  return clampByte(Math.round((nr * 0.299 + ng * 0.587 + nb * 0.114) / 257));
}

export function stfGamma2RgbToGray8Resampled(source: Uint16Array, sourceWidth: number, sourceHeight: number,
  targetWidth: number, targetHeight: number, encodingScale = 1): Uint8Array {
  if (source.length !== sourceWidth * sourceHeight * 3 ||
    ![sourceWidth, sourceHeight, targetWidth, targetHeight].every((n) => Number.isInteger(n) && n > 0)) {
    throw new Error("Invalid STF Optical Flow grayscale image dimensions");
  }
  const gray = new Uint8Array(targetWidth * targetHeight);
  if (targetWidth === sourceWidth && targetHeight === sourceHeight) {
    for (let pixel = 0; pixel < gray.length; pixel += 1) {
      const base = pixel * 3;
      gray[pixel] = rgb16ToGray8(source[base], source[base + 1], source[base + 2], encodingScale);
    }
    return gray;
  }
  const maxX = sourceWidth - 1;
  const maxY = sourceHeight - 1;
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = targetHeight === 1 ? 0 : ((y + 0.5) * sourceHeight / targetHeight) - 0.5;
    const sy = clamp(sourceY, 0, maxY);
    const y0 = Math.floor(sy);
    const y1 = Math.min(maxY, y0 + 1);
    const fy = sy - y0;
    const row0 = y0 * sourceWidth;
    const row1 = y1 * sourceWidth;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = targetWidth === 1 ? 0 : ((x + 0.5) * sourceWidth / targetWidth) - 0.5;
      const sx = clamp(sourceX, 0, maxX);
      const x0 = Math.floor(sx);
      const x1 = Math.min(maxX, x0 + 1);
      const fx = sx - x0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const i00 = (row0 + x0) * 3;
      const i10 = (row0 + x1) * 3;
      const i01 = (row1 + x0) * 3;
      const i11 = (row1 + x1) * 3;
      const luminance = rgb16ToGray8(source[i00], source[i00 + 1], source[i00 + 2], encodingScale) * w00
        + rgb16ToGray8(source[i10], source[i10 + 1], source[i10 + 2], encodingScale) * w10
        + rgb16ToGray8(source[i01], source[i01 + 1], source[i01 + 2], encodingScale) * w01
        + rgb16ToGray8(source[i11], source[i11 + 1], source[i11 + 2], encodingScale) * w11;
      gray[y * targetWidth + x] = clampByte(Math.round(luminance));
    }
  }
  return gray;
}
