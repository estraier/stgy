import { encodeStoredRgb16Channel } from "@/image/rgb16-storage";
import {
  readCanonicalLinearRows,
  type PreparedCanonicalSession,
} from "./canonical-source";

const CENTER_FILL_GRAY_LINEAR = 0.21586050011389926; // sRGB 128 / 255 decoded to linear.

type NormalizationMode = "feature-match" | "center-crop" | "center-fit" | "center-fill" | "top-left-fill";

type AlignmentPlanLike = {
  normalizationMode: NormalizationMode;
  targetWidth: number;
  targetHeight: number;
};

export type ResolvedAlignmentLike = {
  matrices: Array<Float64Array | number[] | null>;
};

type SourceGeometry = {
  width: number;
  height: number;
  mode: NormalizationMode;
  targetWidth: number;
  targetHeight: number;
  cropX: number;
  cropY: number;
  dx: number;
  dy: number;
  resizedWidth: number;
  resizedHeight: number;
  scaleX: number;
  scaleY: number;
};

function inverse3x3(input: ArrayLike<number>): Float64Array {
  const a = Number(input[0]), b = Number(input[1]), c = Number(input[2]);
  const d = Number(input[3]), e = Number(input[4]), f = Number(input[5]);
  const g = Number(input[6]), h = Number(input[7]), i = Number(input[8]);
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error("Alignment transform is singular.");
  const invDet = 1 / det;
  return new Float64Array([A * invDet, B * invDet, C * invDet, D * invDet, E * invDet, F * invDet, G * invDet, H * invDet, I * invDet]);
}

function identityMatrix(): Float64Array {
  return new Float64Array([1,0,0, 0,1,0, 0,0,1]);
}

function sourceGeometry(width: number, height: number, plan: AlignmentPlanLike): SourceGeometry {
  const tw = plan.targetWidth;
  const th = plan.targetHeight;
  const mode = plan.normalizationMode;
  let cropX = 0, cropY = 0, dx = 0, dy = 0, resizedWidth = width, resizedHeight = height, scaleX = 1, scaleY = 1;
  if (mode === "center-crop") {
    cropX = Math.floor((width - tw) / 2);
    cropY = Math.floor((height - th) / 2);
  } else if (mode === "center-fill" || mode === "top-left-fill") {
    dx = mode === "center-fill" ? Math.floor((tw - width) / 2) : 0;
    dy = mode === "center-fill" ? Math.floor((th - height) / 2) : 0;
  } else if (mode === "center-fit") {
    const scale = Math.max(tw / width, th / height);
    resizedWidth = Math.max(tw, Math.round(width * scale));
    resizedHeight = Math.max(th, Math.round(height * scale));
    dx = Math.floor((tw - resizedWidth) / 2);
    dy = Math.floor((th - resizedHeight) / 2);
    scaleX = resizedWidth / width;
    scaleY = resizedHeight / height;
  }
  return { width, height, mode, targetWidth: tw, targetHeight: th, cropX, cropY, dx, dy, resizedWidth, resizedHeight, scaleX, scaleY };
}

function normalizedToSource(g: SourceGeometry, nx: number, ny: number): { x: number; y: number; fill: boolean } {
  if (g.mode === "feature-match") return { x: nx, y: ny, fill: false };
  if (g.mode === "center-crop") return { x: nx + g.cropX, y: ny + g.cropY, fill: false };
  if (g.mode === "center-fill" || g.mode === "top-left-fill") {
    const x = nx - g.dx;
    const y = ny - g.dy;
    return { x, y, fill: x < 0 || y < 0 || x > g.width - 1 || y > g.height - 1 };
  }
  if (g.mode === "center-fit") {
    const rx = nx - g.dx;
    const ry = ny - g.dy;
    // OpenCV INTER_LINEAR resize uses pixel-center mapping.
    return { x: (rx + 0.5) / g.scaleX - 0.5, y: (ry + 0.5) / g.scaleY - 0.5, fill: false };
  }
  throw new Error(`Unsupported normalization mode: ${g.mode}`);
}

function mapDestinationToNormalized(inv: Float64Array, x: number, y: number): { x: number; y: number } {
  const w = inv[6] * x + inv[7] * y + inv[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return { x: Number.NaN, y: Number.NaN };
  return { x: (inv[0] * x + inv[1] * y + inv[2]) / w, y: (inv[3] * x + inv[4] * y + inv[5]) / w };
}

function clamp(value: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, value)); }

export class AlignedImageReader {
  readonly width: number;
  readonly height: number;
  private readonly geometries: SourceGeometry[];
  private readonly inverseMatrices: Float64Array[];

  constructor(
    private readonly session: PreparedCanonicalSession,
    private readonly plan: AlignmentPlanLike,
    alignment: ResolvedAlignmentLike,
  ) {
    this.width = plan.targetWidth;
    this.height = plan.targetHeight;
    this.geometries = session.images.map((image) => sourceGeometry(image.width, image.height, plan));
    this.inverseMatrices = session.images.map((_, index) => inverse3x3(alignment.matrices[index] || identityMatrix()));
  }

  async readLinearRegion(imageIndex: number, x: number, y: number, width: number, height: number): Promise<Float32Array> {
    const g = this.geometries[imageIndex];
    const inv = this.inverseMatrices[imageIndex];
    if (!g || !inv) throw new Error(`Aligned input ${imageIndex + 1} is unavailable.`);
    if (![x,y,width,height].every(Number.isFinite) || width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > this.width || y + height > this.height) throw new Error("Aligned region is outside the output image.");

    // Determine the source Y interval. Alignment transforms in LSS are affine; for a
    // perspective matrix we conservatively read the whole source image.
    let minY = Infinity, maxY = -Infinity;
    const affine = Math.abs(inv[6]) < 1e-12 && Math.abs(inv[7]) < 1e-12;
    if (affine) {
      const corners = [[x,y],[x+width-1,y],[x,y+height-1],[x+width-1,y+height-1]];
      for (const [dx,dy] of corners) {
        const n = mapDestinationToNormalized(inv, dx, dy);
        const s = normalizedToSource(g, n.x, n.y);
        if (!s.fill && Number.isFinite(s.y)) { minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); }
      }
    }
    let rowStart: number, rowEnd: number;
    if (!affine || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      rowStart = 0; rowEnd = g.height;
    } else {
      rowStart = clamp(Math.floor(minY) - 2, 0, g.height - 1);
      rowEnd = clamp(Math.ceil(maxY) + 3, rowStart + 1, g.height);
    }
    const source = await readCanonicalLinearRows(this.session, imageIndex, rowStart, rowEnd - rowStart);
    const sourceRows = rowEnd - rowStart;
    const output = new Float32Array(width * height * 3);

    let out = 0;
    for (let localY = 0; localY < height; localY += 1) {
      const dy = y + localY;
      for (let localX = 0; localX < width; localX += 1) {
        const dx = x + localX;
        const n = mapDestinationToNormalized(inv, dx, dy);
        const p = normalizedToSource(g, n.x, n.y);
        if (p.fill || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          output[out++] = CENTER_FILL_GRAY_LINEAR;
          output[out++] = CENTER_FILL_GRAY_LINEAR;
          output[out++] = CENTER_FILL_GRAY_LINEAR;
          continue;
        }
        // BORDER_REPLICATE is defined against the normalized source bounds. For
        // center-crop, normalizedToSource already offsets into the crop; clamping
        // here against the crop ROI avoids sampling outside that virtual image.
        let minXBound = 0, maxXBound = g.width - 1, minYBound = 0, maxYBound = g.height - 1;
        if (g.mode === "center-crop") {
          minXBound = g.cropX; maxXBound = g.cropX + g.targetWidth - 1;
          minYBound = g.cropY; maxYBound = g.cropY + g.targetHeight - 1;
        }
        const sx = clamp(p.x, minXBound, maxXBound);
        const sy = clamp(p.y, minYBound, maxYBound);
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(maxXBound, x0 + 1), y1 = Math.min(maxYBound, y0 + 1);
        const fx = sx - x0, fy = sy - y0;
        const ly0 = clamp(y0 - rowStart, 0, sourceRows - 1);
        const ly1 = clamp(y1 - rowStart, 0, sourceRows - 1);
        const i00 = (ly0 * g.width + x0) * 3;
        const i10 = (ly0 * g.width + x1) * 3;
        const i01 = (ly1 * g.width + x0) * 3;
        const i11 = (ly1 * g.width + x1) * 3;
        const w00 = (1-fx)*(1-fy), w10 = fx*(1-fy), w01 = (1-fx)*fy, w11 = fx*fy;
        for (let c=0;c<3;c+=1) output[out++] = source[i00+c]*w00 + source[i10+c]*w10 + source[i01+c]*w01 + source[i11+c]*w11;
      }
    }
    return output;
  }

  async readGamma2Region(imageIndex: number, x: number, y: number, width: number, height: number, linearRangeMax: 1 | 4 = 1): Promise<Uint16Array> {
    const linear = await this.readLinearRegion(imageIndex, x, y, width, height);
    const output = new Uint16Array(linear.length);
    for (let i=0;i<linear.length;i+=1) output[i] = encodeStoredRgb16Channel(linear[i], "gamma20", linearRangeMax);
    return output;
  }

  readLinearImage(imageIndex: number): Promise<Float32Array> {
    return this.readLinearRegion(imageIndex, 0, 0, this.width, this.height);
  }

  readGamma2Image(imageIndex: number, linearRangeMax: 1 | 4 = 1): Promise<Uint16Array> {
    return this.readGamma2Region(imageIndex, 0, 0, this.width, this.height, linearRangeMax);
  }
}
