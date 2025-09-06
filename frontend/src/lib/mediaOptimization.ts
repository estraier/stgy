import { Config } from "@/config";

export type Meta = { mime: string; size: number; w: number; h: number };

type ImageBitmapOptionsWithOrientation = ImageBitmapOptions & {
  imageOrientation?: "from-image" | "none";
};

export async function readMetaFromFile(
  file: File,
): Promise<Meta & { previewUrl: string; decodable: boolean }> {
  const url = URL.createObjectURL(file);
  try {
    if ("createImageBitmap" in window) {
      try {
        const opts: ImageBitmapOptionsWithOrientation = { imageOrientation: "from-image" };
        const bmp = await createImageBitmap(file, opts as ImageBitmapOptions);
        const out: Meta & { previewUrl: string; decodable: boolean } = {
          mime: file.type || "application/octet-stream",
          size: file.size,
          w: bmp.width,
          h: bmp.height,
          previewUrl: url,
          decodable: true,
        };
        bmp.close?.();
        return out;
      } catch {}
    }
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return {
      mime: file.type || "application/octet-stream",
      size: file.size,
      w: img.naturalWidth,
      h: img.naturalHeight,
      previewUrl: url,
      decodable: true,
    };
  } catch {
    return {
      mime: file.type || "application/octet-stream",
      size: file.size,
      w: 0,
      h: 0,
      previewUrl: url,
      decodable: false,
    };
  }
}

export function shouldAutoOptimize(meta: Pick<Meta, "size" | "w" | "h">): boolean {
  const longSide = Math.max(meta.w, meta.h);
  const pixels = meta.w * meta.h;
  return (
    meta.size > Config.IMAGE_OPTIMIZE_TRIGGER_BYTES ||
    longSide > Config.IMAGE_OPTIMIZE_TRIGGER_LONGSIDE ||
    pixels > Config.IMAGE_OPTIMIZE_TRIGGER_PIXELS
  );
}

function computeResize(w: number, h: number) {
  const maxSideScale = Config.IMAGE_OPTIMIZE_TARGET_LONGSIDE / Math.max(w, h);
  const pixelScale = Math.sqrt(Config.IMAGE_OPTIMIZE_TARGET_PIXELS / Math.max(1, w * h));
  const scale = Math.min(1, maxSideScale, pixelScale);
  return {
    outW: Math.max(1, Math.round(w * scale)),
    outH: Math.max(1, Math.round(h * scale)),
  };
}

export async function rasterToWebp(
  file: File,
  srcW: number,
  srcH: number,
  quality = 0.82,
): Promise<Meta & { blob: Blob }> {
  const opts: ImageBitmapOptionsWithOrientation = { imageOrientation: "from-image" };
  const bmp = await createImageBitmap(file, opts as ImageBitmapOptions);
  const { outW, outH } = computeResize(srcW, srcH);

  let blob: Blob;
  if (typeof OffscreenCanvas !== "undefined") {
    const osc = new OffscreenCanvas(outW, outH);
    const ctx = osc.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
      bmp.close?.();
      throw new Error("no canvas context");
    }
    ctx.drawImage(bmp, 0, 0, outW, outH);
    blob = await osc.convertToBlob({ type: "image/webp", quality });
  } else {
    const cv = document.createElement("canvas");
    cv.width = outW;
    cv.height = outH;
    const ctx = cv.getContext("2d", {
      alpha: false,
      colorSpace: "srgb",
    }) as CanvasRenderingContext2D | null;
    if (!ctx) {
      bmp.close?.();
      throw new Error("no canvas context");
    }
    ctx.drawImage(bmp, 0, 0, outW, outH);
    blob = await new Promise<Blob>((resolve, reject) =>
      cv.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/webp",
        quality,
      ),
    );
  }

  bmp.close?.();
  return { mime: "image/webp", size: blob.size, w: outW, h: outH, blob };
}

export function changeExtToWebp(name: string): string {
  return name.replace(/\.[^.]+$/, "") + ".webp";
}
