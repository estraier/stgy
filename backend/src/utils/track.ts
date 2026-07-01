import { Readable } from "stream";
import { createGunzip } from "zlib";

export type TrackJsonOperationalLimits = {
  maxFeatures: number;
  maxPoints: number;
  maxPropertyValues: number;
  maxDepth: number;
};

type StackItem = {
  value: unknown;
  depth: number;
  key?: string;
};

export function sniffFitHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 12) {
    return false;
  }
  const headerSize = bytes[0];
  if (headerSize !== 12 && headerSize !== 14) {
    return false;
  }
  if (bytes.length < headerSize) {
    return false;
  }
  return (
    bytes[8] === 0x2e &&
    bytes[9] === 0x46 &&
    bytes[10] === 0x49 &&
    bytes[11] === 0x54
  );
}

export function sniffGzipHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08;
}

export async function gunzipWithLimit(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("invalid gzip size limit");
  }

  return await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const input = Readable.from([Buffer.from(bytes)]);
    const gunzip = createGunzip();

    function fail(e: Error) {
      if (done) {
        return;
      }
      done = true;
      input.destroy();
      gunzip.destroy();
      reject(e);
    }

    gunzip.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        fail(new Error("track json too large"));
        return;
      }
      chunks.push(chunk);
    });

    gunzip.on("end", () => {
      if (done) {
        return;
      }
      done = true;
      resolve(new Uint8Array(Buffer.concat(chunks, total)));
    });

    gunzip.on("error", fail);
    input.on("error", fail);
    input.pipe(gunzip);
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countCoordinatePositions(value: unknown, maxPoints: number): number {
  const stack: unknown[] = [value];
  let count = 0;

  while (stack.length > 0) {
    const cur = stack.pop();
    if (!Array.isArray(cur)) {
      continue;
    }

    if (cur.length >= 2 && typeof cur[0] === "number" && typeof cur[1] === "number") {
      count++;
      if (count > maxPoints) {
        throw new Error("too many track points");
      }
      continue;
    }

    for (const item of cur) {
      if (Array.isArray(item)) {
        stack.push(item);
      }
    }
  }

  return count;
}

function countArrayLeafValues(value: unknown, maxValues: number): number {
  const stack: unknown[] = [value];
  let count = 0;

  while (stack.length > 0) {
    const cur = stack.pop();
    if (!Array.isArray(cur)) {
      continue;
    }

    for (const item of cur) {
      if (Array.isArray(item)) {
        stack.push(item);
      } else {
        count++;
        if (count > maxValues) {
          throw new Error("too many track property values");
        }
      }
    }
  }

  return count;
}

export function validateTrackJsonOperationalLimits(
  data: unknown,
  limits: TrackJsonOperationalLimits,
): void {
  if (!isPlainObject(data)) {
    throw new Error("invalid track json");
  }
  if (data.type !== "FeatureCollection") {
    throw new Error("invalid track json");
  }
  if (!Array.isArray(data.features)) {
    throw new Error("invalid track json");
  }
  if (data.features.length > limits.maxFeatures) {
    throw new Error("too many track features");
  }

  const stack: StackItem[] = [{ value: data, depth: 1 }];
  let totalPoints = 0;
  let totalPropertyValues = 0;

  while (stack.length > 0) {
    const item = stack.pop()!;
    const { value, depth, key } = item;
    if (depth > limits.maxDepth) {
      throw new Error("track json too deep");
    }

    if (key === "coordinates") {
      totalPoints += countCoordinatePositions(value, limits.maxPoints - totalPoints);
      if (totalPoints > limits.maxPoints) {
        throw new Error("too many track points");
      }
      continue;
    }

    if (key === "coordinateProperties" && isPlainObject(value)) {
      for (const propertyValue of Object.values(value)) {
        totalPropertyValues += countArrayLeafValues(
          propertyValue,
          limits.maxPropertyValues - totalPropertyValues,
        );
        if (totalPropertyValues > limits.maxPropertyValues) {
          throw new Error("too many track property values");
        }
      }
      continue;
    }

    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({ value: value[i], depth: depth + 1 });
      }
    } else if (isPlainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        stack.push({ value: childValue, depth: depth + 1, key: childKey });
      }
    }
  }
}
