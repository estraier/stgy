import type { GTypedOperation, GKernelPackage, GraphPortMap, GraphPortType, GraphMatDescriptor } from '../lib/opencv.js';
/** A nonempty tuple of graph port names, inferred from a literal operation signature. */
export type GraphPorts = readonly [GraphPortType, ...GraphPortType[]];
/** Native graph nodes in the order declared by a custom operation. */
export type GraphNodes<Ports extends GraphPorts> = {
    -readonly [Index in keyof Ports]: GraphPortMap[Ports[Index]]['node'];
};
/** Runtime values in the order declared by a custom operation. */
export type GraphValues<Ports extends GraphPorts> = {
    -readonly [Index in keyof Ports]: GraphPortMap[Ports[Index]]['value'];
};
/** Only matrix ports need a layout. Other ports have null metadata. */
export type GraphDescriptors<Ports extends GraphPorts> = {
    [Index in keyof Ports]: Ports[Index] extends 'mat' ? GraphMatDescriptor : null;
};
/** Synchronous callback with borrowed matrix/primitive handles. Fill matrices or assign output values. */
export type TypedGraphKernel<Inputs extends GraphPorts, Outputs extends GraphPorts> = (inputs: Readonly<GraphValues<Inputs>>, outputs: GraphValues<Outputs>) => undefined;
/** Matrix outputs require metadata; purely scalar, array and opaque operations can omit it. */
export type TypedGraphSignature<Inputs extends GraphPorts, Outputs extends GraphPorts> = {
    /** Nonempty ordered tuple of input port names. */
    inputs: Inputs;
    /** Nonempty ordered tuple of output port names. */
    outputs: Outputs;
} & ('mat' extends Outputs[number] ? {
    /** Synchronously derive output layouts; use null for each non-matrix port. */
    outMeta: (inputs: GraphDescriptors<Inputs>) => GraphDescriptors<Outputs>;
} : {
    /** Optional synchronous metadata callback; all output entries must be null. */
    outMeta?: (inputs: GraphDescriptors<Inputs>) => GraphDescriptors<Outputs>;
});
/** A native operation with its exact node tuple and callback signature preserved by TypeScript. */
export type TypedGraphOperation<Inputs extends GraphPorts, Outputs extends GraphPorts> = Omit<GTypedOperation, 'on' | 'kernel' | 'clone'> & {
    /** Connect graph nodes in input-port order and return owned nodes in output-port order. */
    on(inputs: Readonly<GraphNodes<Inputs>>): GraphNodes<Outputs>;
    /** Create an owned CPU kernel package. Callback handles are borrowed; fill matrices and assign the other output slots synchronously. */
    kernel(run: TypedGraphKernel<Inputs, Outputs>): GKernelPackage;
    /** Retain another owned handle to the same native operation without copying its configuration. */
    clone(): TypedGraphOperation<Inputs, Outputs>;
};
//# sourceMappingURL=graph-types.d.ts.map