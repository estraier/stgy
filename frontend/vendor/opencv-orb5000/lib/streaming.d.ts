import type { MainModule, GComputation, GCompileArgs, GraphValue, GraphSource, GraphFrames, GraphStreamHandle } from '../lib/opencv.js';
/** Convert a synchronous or asynchronous iterable to a source with explicit end-of-stream cleanup. */
export declare const makeIterableSource: (frames: GraphFrames) => GraphSource;
/** Serial graph execution over frame sources. Use await using or await delete() to release retained handles. */
export declare class GraphStream implements GraphStreamHandle {
    #private;
    /** Retain a computation and its compilation options for serial frame execution. The original handles remain caller-owned. */
    constructor(graph: GComputation, options?: GCompileArgs);
    /** Set a source before starting. Stop the previous source before replacing it. */
    setSource(source: GraphSource | GraphFrames): void;
    /** Begin pulling the configured source. No work is queued ahead of pull(). */
    start(): void;
    /** True while accepting frames. End of stream, stop and callback failures clear this state. */
    running(): boolean;
    /** Return owned graph outputs, or null at end of stream. Concurrent pulls are rejected. */
    pull(): Promise<GraphValue[] | null>;
    /** Abort a pending source read and close the source after the read settles. */
    stop(): Promise<void>;
    /** Idempotently stop the source and dispose the retained computation and compile arguments. */
    delete(): Promise<void>;
    /** Integrate with TypeScript's await using resource management. */
    [Symbol.asyncDispose](): Promise<void>;
}
/** Create file and iterable source factories for one isolated OpenCV instance. */
export declare const createStreamAPI: (cv: MainModule) => {
    /** Open an MJPEG AVI or image-sequence source in the virtual filesystem. Frame matrices are automatically released after graph execution. */
    make_capture_src: (path: string, apiPreference?: number) => GraphSource;
    /** Wrap an iterable of frame inputs as a serial source with EOF cleanup. Values are borrowed unless a frame provides release(). */
    make_js_src: (frames: GraphFrames) => GraphSource;
    /** Return an existing source or adapt a synchronous/asynchronous iterable. */
    get_streaming_source: (source: GraphSource | GraphFrames) => GraphSource;
};
/** Install the streaming adapter on this instance's computation prototype. */
export declare const installGraphStreaming: (cv: MainModule) => void;
//# sourceMappingURL=streaming.d.ts.map