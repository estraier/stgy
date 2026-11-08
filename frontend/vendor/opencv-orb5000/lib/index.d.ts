import type { MainModule } from '../lib/opencv.js';
import type { NativeNamespaces, AugmentedModule } from '../lib/namespaces.js';
import { createValueAPI } from './values.js';
import { createGraphAPI } from './graph.js';
import { createStreamAPI } from './streaming.js';
export { GraphStream, makeIterableSource } from './streaming.js';
export type { CVNamespace } from '../lib/namespaces.js';
/** All native functions, classes, constants and enums in this build. */
export type OpenCV = AugmentedModule & Omit<NativeNamespaces, 'gapi' | 'xfeatures2d'> & ReturnType<typeof createValueAPI> & ReturnType<typeof createGraphAPI> & {
    gapi: Omit<NativeNamespaces['gapi'], keyof ReturnType<typeof createGraphAPI> | 'wip'> & ReturnType<typeof createGraphAPI> & {
        wip: NativeNamespaces['gapi']['wip'] & ReturnType<typeof createStreamAPI>;
    };
    xfeatures2d: NativeNamespaces['xfeatures2d'] & {
        SIFT_create: MainModule['SIFT_create'];
    };
};
export * from './named.js';
export { initOpenCV } from './default.js';
export type * from './graph-types.js';
export { matFromArray, matFromImageData, toImageData, decodeImage, encodeImage } from './images.js';
/** Loading options; use wasmUrl with bundlers or wasmBinary for an in-memory binary. */
export type OpenCVOptions = {
    /** URL of the packaged WASM asset. In Node, the adjacent installed binary is loaded automatically when omitted. */
    wasmUrl?: string | URL;
    /** Already loaded WASM bytes, avoiding a separate asset fetch. */
    wasmBinary?: Uint8Array<ArrayBuffer>;
    /** Receive native standard-output messages. */
    print?: (text: string) => void;
    /** Receive native diagnostics and standard-error messages. */
    printErr?: (text: string) => void;
};
/**
 * Load an isolated CPU OpenCV WebAssembly instance in a browser, worker or Node.js.
 * @param options Asset-loading and native logging options.
 * @returns The fully typed API after native initialization. Release native objects with delete() or using; handles cannot be shared between instances.
 */
export declare const createOpenCV: (options?: OpenCVOptions) => Promise<OpenCV>;
//# sourceMappingURL=index.d.ts.map