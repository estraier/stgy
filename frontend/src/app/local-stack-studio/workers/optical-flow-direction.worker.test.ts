import type {
  OpticalFlowDirectionRequest,
  OpticalFlowDirectionResponse,
} from "./protocols/optical-flow-direction-protocol";

type Scope = {
  onmessage: ((event: MessageEvent<OpticalFlowDirectionRequest>) => Promise<void>) | null;
  postMessage: (message: OpticalFlowDirectionResponse, transfer?: Transferable[]) => void;
};

test("native Optical Flow worker preserves the exact Farneback settings and direction", async () => {
  const nativeCalls: Array<{ source: number; target: number; settings: number[] }> = [];
  const previousOnmessage = Object.getOwnPropertyDescriptor(globalThis, "onmessage");
  const previousPostMessage = Object.getOwnPropertyDescriptor(globalThis, "postMessage");
  const responses: OpticalFlowDirectionResponse[] = [];

  class MockMat {
    data: Uint8Array;
    data32F: Float32Array;
    constructor(rows = 0, cols = 0) {
      this.data = new Uint8Array(rows * cols);
      this.data32F = new Float32Array(rows * cols * 2);
    }
    delete() {}
  }

  const cv = {
    Mat: MockMat,
    CV_8UC1: 0,
    calcOpticalFlowFarneback(source: MockMat, target: MockMat, flow: MockMat, ...settings: number[]) {
      nativeCalls.push({ source: source.data[0], target: target.data[0], settings });
      const dx = source.data[0] < target.data[0] ? 2 : -2;
      flow.data32F = new Float32Array(8);
      for (let i = 0; i < flow.data32F.length; i += 2) flow.data32F[i] = dx;
    },
  };

  jest.resetModules();
  jest.doMock("./opencv-runtime", () => ({ loadWorkerOpenCv: async () => cv }));
  Object.defineProperty(globalThis, "postMessage", {
    configurable: true, value: (message: OpticalFlowDirectionResponse) => responses.push(message),
  });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./optical-flow-direction.worker");
    const scope = globalThis as unknown as Scope;
    if (!scope.onmessage) throw new Error("Direction worker did not install onmessage.");
    await scope.onmessage({ data: { type: "init", requestId: 1 } } as MessageEvent<OpticalFlowDirectionRequest>);
    await scope.onmessage({
      data: {
        type: "compute-pair", requestId: 2, width: 2, height: 2,
        previousGrayBuffer: new Uint8Array([10, 10, 10, 10]).buffer,
        nextGrayBuffer: new Uint8Array([20, 20, 20, 20]).buffer,
      },
    } as MessageEvent<OpticalFlowDirectionRequest>);

    expect(responses[0].type).toBe("ready");
    const result = responses[1];
    expect(result.type).toBe("pair-result");
    if (result.type !== "pair-result") return;
    expect(new Float32Array(result.forwardBuffer)[0]).toBe(2);
    expect(new Float32Array(result.backwardBuffer)[0]).toBe(-2);
    expect(nativeCalls).toEqual([
      { source: 10, target: 20, settings: [0.5, 5, 21, 3, 7, 1.5, 0] },
      { source: 20, target: 10, settings: [0.5, 5, 21, 3, 7, 1.5, 0] },
    ]);
  } finally {
    if (previousOnmessage) Object.defineProperty(globalThis, "onmessage", previousOnmessage);
    else Reflect.deleteProperty(globalThis, "onmessage");
    if (previousPostMessage) Object.defineProperty(globalThis, "postMessage", previousPostMessage);
    else Reflect.deleteProperty(globalThis, "postMessage");
    jest.dontMock("./opencv-runtime");
  }
});
