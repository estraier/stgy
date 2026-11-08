import { type OpenCV, type OpenCVOptions } from './index.js';
/** Register generated live exports before initialization. Internal to the package. */
export declare const registerDefaultBindings: (install: (cv: OpenCV) => void) => void;
/** Get the initialized shared instance for image helper overloads. Internal to the package. */
export declare const getDefaultOpenCV: () => OpenCV;
/** Throw an actionable error if a named constructor, function or namespace is used before initialization. Internal. */
export declare const uninitializedExport: <T>(name: string) => T;
/**
 * Initialize the shared OpenCV instance used by named imports such as Mat and GaussianBlur.
 * @param options WASM asset and logging options. The first successful call configures this instance; later calls reuse it.
 * @returns The shared instance, also useful for image helpers and advanced memory access. Concurrent calls share one load; failed loads can be retried.
 * @remarks Await this before using any named native export. Importing the package alone never loads WASM. Each worker has its own instance. createOpenCV() still creates isolated instances and never rebinds these imports; do not mix their native handles.
 */
export declare const initOpenCV: (options?: OpenCVOptions) => Promise<OpenCV>;
//# sourceMappingURL=default.d.ts.map