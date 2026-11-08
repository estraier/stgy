import type { MainModule, Mat, GOperation, GraphValue, GraphMetadataFunction, GraphKernelFunction, GKernelPackage, GCompileArg, gapi_streaming_queue_capacity, gapi_GNetPackage, gapi_dnn_Params } from '../lib/opencv.js';
import type { GraphPorts, TypedGraphSignature, TypedGraphOperation, TypedGraphKernel } from './graph-types.js';
/** TypeScript conveniences for the native CPU graph API and Python's graph factories. */
export declare const createGraphAPI: (cv: MainModule) => {
    /** Create owned graph placeholders for typed arrays of runtime values. */
    GArray: {
        /** Create an owned graph placeholder for an array of boolean values. */
        Bool: () => import("../lib/opencv.js").GArray_bool;
        /** Create an owned graph placeholder for an array of signed 32-bit integer values. */
        Int: () => import("../lib/opencv.js").GArray_int;
        /** Create an owned graph placeholder for an array of signed 64-bit bigint values. */
        Int64: () => import("../lib/opencv.js").GArray_int64_t;
        /** Create an owned graph placeholder for an array of unsigned 64-bit bigint values. */
        UInt64: () => import("../lib/opencv.js").GArray_uint64_t;
        /** Create an owned graph placeholder for an array of double-precision number values. */
        Double: () => import("../lib/opencv.js").GArray_double;
        /** Create an owned graph placeholder for an array of single-precision number values. */
        Float: () => import("../lib/opencv.js").GArray_float;
        /** Create an owned graph placeholder for an array of string values. */
        String: () => import("../lib/opencv.js").GArray_string;
        /** Create an owned graph placeholder for an array of integer point values. */
        Point: () => import("../lib/opencv.js").GArray_Point2i;
        /** Create an owned graph placeholder for an array of two-dimensional floating-point point values. */
        Point2f: () => import("../lib/opencv.js").GArray_Point2f;
        /** Create an owned graph placeholder for an array of three-dimensional floating-point point values. */
        Point3f: () => import("../lib/opencv.js").GArray_Point3f;
        /** Create an owned graph placeholder for an array of integer image extent values. */
        Size: () => import("../lib/opencv.js").GArray_Size;
        /** Create an owned graph placeholder for an array of integer rectangle values. */
        Rect: () => import("../lib/opencv.js").GArray_Rect;
        /** Create an owned graph placeholder for an array of matrix values. */
        Mat: () => import("../lib/opencv.js").GArray_Mat;
        /** Create an owned graph placeholder for an array of four-component scalar values. */
        Scalar: () => import("../lib/opencv.js").GArray_Scalar;
        /** Create an owned graph placeholder for an array of drawing primitive values. */
        Prim: () => import("../lib/opencv.js").GArray_Prim;
    };
    /** Create owned graph placeholders for single typed runtime values. */
    GOpaque: {
        /** Create an owned graph placeholder for one boolean value. */
        Bool: () => import("../lib/opencv.js").GOpaque_bool;
        /** Create an owned graph placeholder for one signed 32-bit integer value. */
        Int: () => import("../lib/opencv.js").GOpaque_int;
        /** Create an owned graph placeholder for one signed 64-bit bigint value. */
        Int64: () => import("../lib/opencv.js").GOpaque_int64_t;
        /** Create an owned graph placeholder for one unsigned 64-bit bigint value. */
        UInt64: () => import("../lib/opencv.js").GOpaque_uint64_t;
        /** Create an owned graph placeholder for one double-precision number value. */
        Double: () => import("../lib/opencv.js").GOpaque_double;
        /** Create an owned graph placeholder for one single-precision number value. */
        Float: () => import("../lib/opencv.js").GOpaque_float;
        /** Create an owned graph placeholder for one string value. */
        String: () => import("../lib/opencv.js").GOpaque_string;
        /** Create an owned graph placeholder for one integer point value. */
        Point: () => import("../lib/opencv.js").GOpaque_Point;
        /** Create an owned graph placeholder for one two-dimensional floating-point point value. */
        Point2f: () => import("../lib/opencv.js").GOpaque_Point2f;
        /** Create an owned graph placeholder for one three-dimensional floating-point point value. */
        Point3f: () => import("../lib/opencv.js").GOpaque_Point3f;
        /** Create an owned graph placeholder for one integer image extent value. */
        Size: () => import("../lib/opencv.js").GOpaque_Size;
        /** Create an owned graph placeholder for one integer rectangle value. */
        Rect: () => import("../lib/opencv.js").GOpaque_Rect;
    };
    /** Collect borrowed runtime inputs in the order declared by GIn. */
    gin: (...values: GraphValue[]) => GraphValue[];
    /** Read matrix layouts as plain metadata values. */
    descr_of: (...values: Mat[]) => import("./named.js").GraphMatDescriptor[];
    /** Define a custom native operation with typed port tuples or matrix counts. Matrix outputs require an outMeta layout callback. Returns an owned operation. */
    op: {
        <const Inputs extends GraphPorts, const Outputs extends GraphPorts>(id: string, signature: TypedGraphSignature<Inputs, Outputs>): TypedGraphOperation<Inputs, Outputs>;
        (id: string, signature: {
            inputs: number;
            outputs: number;
            outMeta: GraphMetadataFunction;
        }): GOperation;
    };
    /** Implement a custom operation with a synchronous CPU callback. Handles are borrowed until return; fill matrix outputs and assign other output slots. Returns an owned kernel package. */
    kernel: {
        <Inputs extends GraphPorts, Outputs extends GraphPorts>(operation: TypedGraphOperation<Inputs, Outputs>, run: TypedGraphKernel<NoInfer<Inputs>, NoInfer<Outputs>>): GKernelPackage;
        (operation: GOperation, run: GraphKernelFunction): GKernelPackage;
    };
    /** Combine kernel packages into a new owned package. */
    kernels: (...packages: GKernelPackage[]) => GKernelPackage;
    /** Package DNN network configurations with unique tags for graph compilation. Returns an owned package. */
    networks: (...parameters: gapi_dnn_Params[]) => gapi_GNetPackage;
    /** Collect kernels, networks and compilation options in a new owned argument vector. */
    compile_args: (...values: (GKernelPackage | GCompileArg | gapi_streaming_queue_capacity | gapi_GNetPackage)[]) => import("../lib/opencv.js").GCompileArgs;
    /** Declare the graph's ordered input nodes; dispose the returned protocol handle. */
    GIn: (nodes: readonly import("./named.js").GraphNode[]) => import("../lib/opencv.js").GProtoInputArgs;
    /** Declare the graph's ordered output nodes; dispose the returned protocol handle. */
    GOut: (nodes: readonly import("./named.js").GraphNode[]) => import("../lib/opencv.js").GProtoOutputArgs;
};
//# sourceMappingURL=graph.d.ts.map