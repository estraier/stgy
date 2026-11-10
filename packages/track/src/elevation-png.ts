/* Shared raster decoder for elevation tiles. Disable color conversion to preserve encoded heights. */
const TILE_SIZE = 256;
export async function decodeElevationPng(bytes: ArrayBuffer): Promise<Uint8ClampedArray | undefined> {
  if (typeof createImageBitmap !== 'function') return undefined;
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    colorSpaceConversion: 'none', premultiplyAlpha: 'none',
  });
  try {
    if (bitmap.width !== TILE_SIZE || bitmap.height !== TILE_SIZE) return undefined;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    }
    if (typeof document === 'undefined') return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE; canvas.height = TILE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  } finally { bitmap.close(); }
}

