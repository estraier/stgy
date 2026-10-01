export const MEDIAN_TILE_SIZE = 1024;

export function exactMedianUint16Tile(tiles: readonly Uint16Array[]): Uint16Array {
  if (!Array.isArray(tiles) || tiles.length === 0) {
    throw new Error("Median tile set is empty.");
  }
  const length = tiles[0].length;
  if (!(tiles[0] instanceof Uint16Array)) {
    throw new Error("Median tile set contains an invalid buffer.");
  }
  for (let index = 1; index < tiles.length; index += 1) {
    if (!(tiles[index] instanceof Uint16Array) || tiles[index].length !== length) {
      throw new Error("Median tile set has inconsistent dimensions.");
    }
  }

  const output = new Uint16Array(length);
  const count = tiles.length;
  if (count === 1) {
    output.set(tiles[0]);
    return output;
  }
  if (count === 2) {
    const a = tiles[0];
    const b = tiles[1];
    for (let i = 0; i < length; i += 1) output[i] = Math.round((a[i] + b[i]) / 2);
    return output;
  }
  if (count === 3) {
    const a = tiles[0];
    const b = tiles[1];
    const c = tiles[2];
    for (let i = 0; i < length; i += 1) {
      const av = a[i];
      const bv = b[i];
      const cv = c[i];
      output[i] = av > bv
        ? (bv > cv ? bv : Math.min(av, cv))
        : (av > cv ? av : Math.min(bv, cv));
    }
    return output;
  }

  const scratch = new Uint16Array(count);
  const upperMiddle = count >> 1;
  const even = (count & 1) === 0;
  for (let offset = 0; offset < length; offset += 1) {
    for (let imageIndex = 0; imageIndex < count; imageIndex += 1) {
      const value = tiles[imageIndex][offset];
      let insertAt = imageIndex;
      while (insertAt > 0 && scratch[insertAt - 1] > value) {
        scratch[insertAt] = scratch[insertAt - 1];
        insertAt -= 1;
      }
      scratch[insertAt] = value;
    }
    output[offset] = even
      ? Math.round((scratch[upperMiddle - 1] + scratch[upperMiddle]) / 2)
      : scratch[upperMiddle];
  }
  return output;
}
