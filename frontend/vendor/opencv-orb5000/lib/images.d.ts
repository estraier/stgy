import type { MainModule, Mat } from '../lib/opencv.js';
/** Pixel components accepted by matFromArray. Exact 64-bit integers require bigint. */
type PixelValues = ArrayLike<number> | ArrayLike<bigint> | ArrayLike<boolean>;
type ImagePixels = Pick<ImageData, 'data' | 'width' | 'height'>;
type ColourOrder = 'bgr' | 'rgb' | 'bgra' | 'rgba';
/**
 * Copy row-major interleaved values into an owned native matrix on the shared engine.
 * Await initOpenCV() first. Length must equal rows × cols × channels; use bigint for 64-bit integers.
 * @returns An owned matrix to release with using or delete(). Borrowed heap views are copied before allocation.
 */
export declare function matFromArray(rows: number, cols: number, type: number, data: PixelValues): Mat;
/** Copy numeric values into an owned matrix on an explicitly supplied isolated engine. */
export declare function matFromArray(cv: MainModule, rows: number, cols: number, type: number, data: PixelValues): Mat;
/** Copy canvas RGBA bytes into an owned CV_8UC4 matrix on the initialized shared engine. Dispose after use. */
export declare function matFromImageData(image: ImagePixels): Mat;
/** Copy canvas RGBA bytes into an owned CV_8UC4 matrix on an isolated engine. */
export declare function matFromImageData(cv: MainModule, image: ImagePixels): Mat;
/**
 * Copy a shared-engine 8-bit matrix to independent RGBA ImageData, handling row strides.
 * Requires ImageData in the environment. Default colour order is BGR for three channels, RGBA for four.
 * Use bgra for decoded alpha images. The returned pixels remain valid after the matrix is disposed.
 */
export declare function toImageData(mat: Mat, order?: ColourOrder): ImageData;
/** Copy an isolated engine's 8-bit matrix to independent browser ImageData. */
export declare function toImageData(cv: MainModule, mat: Mat, order?: ColourOrder): ImageData;
/**
 * Decode encoded bytes with native codecs on the initialized shared engine, in browsers or Node.
 * Defaults to IMREAD_COLOR; output colour is BGR or BGRA. Throws if decoding fails.
 * @returns An owned matrix to release with using or delete().
 */
export declare function decodeImage(bytes: Uint8Array, flags?: number): Mat;
/** Decode encoded bytes into an owned matrix on an explicitly supplied isolated engine. */
export declare function decodeImage(cv: MainModule, bytes: Uint8Array, flags?: number): Mat;
/**
 * Encode a shared-engine matrix to independent image bytes; no DOM is required.
 * Extension starts with a dot, such as .png. Native colour codecs expect BGR or BGRA.
 * Parameters are alternating IMWRITE identifiers and values. Throws if encoding fails.
 */
export declare function encodeImage(extension: string, mat: Mat, parameters?: readonly number[]): Uint8Array<ArrayBuffer>;
/** Encode an isolated engine's matrix to independent image bytes. */
export declare function encodeImage(cv: MainModule, extension: string, mat: Mat, parameters?: readonly number[]): Uint8Array<ArrayBuffer>;
export {};
//# sourceMappingURL=images.d.ts.map