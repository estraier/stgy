import type {
  OpticalFlowWorkerRequest,
  OpticalFlowWorkerResponse,
} from "./protocols/optical-flow-protocol";
import type {
  OpticalFlowDirectionRequest,
  OpticalFlowDirectionResponse,
} from "./protocols/optical-flow-direction-protocol";

type ParentScope = {
  onmessage: ((event: MessageEvent<OpticalFlowWorkerRequest>) => Promise<void>) | null;
  postMessage: (message: OpticalFlowWorkerResponse, transfer?: Transferable[]) => void;
};

function syntheticField(width: number, height: number, dx: number): ArrayBuffer {
  const values = new Float32Array(width * height * 2);
  for (let i = 0; i < values.length; i += 2) values[i] = dx;
  return values.buffer;
}

async function runMidpoint(cores: number, memoryGiB: number, additionalVariant?: "ext1" | "ext2", sharedGray = false) {
  jest.resetModules();
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalOnmessage = Object.getOwnPropertyDescriptor(globalThis, "onmessage");
  const originalPostMessage = Object.getOwnPropertyDescriptor(globalThis, "postMessage");
  const messages: OpticalFlowWorkerResponse[] = [];
  let spawned = 0;
  let flowComputations = 0;
  const seenGrays: number[][] = [];

  class FakeDirectionWorker {
    readonly index = spawned++;
    onmessage: ((event: MessageEvent<OpticalFlowDirectionResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;

    constructor(public readonly url: string) {}
    postMessage(message: OpticalFlowDirectionRequest) {
      const respond = (response: OpticalFlowDirectionResponse) => {
        queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<OpticalFlowDirectionResponse>));
      };
      if (message.type === "init") {
        respond({ type: "ready", requestId: message.requestId });
      } else if (message.type === "compute") {
        seenGrays.push([new Uint8Array(message.previousGrayBuffer)[0], new Uint8Array(message.nextGrayBuffer)[0]]);
        flowComputations++;
        respond({
          type: "result", requestId: message.requestId,
          flowBuffer: syntheticField(message.width, message.height, this.index === 0 ? 2 : -2),
          computeMs: 1,
        });
      } else if (message.type === "compute-pair") {
        seenGrays.push([new Uint8Array(message.previousGrayBuffer)[0], new Uint8Array(message.nextGrayBuffer)[0]]);
        flowComputations += 2;
        respond({
          type: "pair-result", requestId: message.requestId,
          forwardBuffer: syntheticField(message.width, message.height, 2),
          backwardBuffer: syntheticField(message.width, message.height, -2),
          forwardMs: 1, backwardMs: 1,
        });
      }
    }
    terminate() {}
  }

  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeDirectionWorker });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { hardwareConcurrency: cores, deviceMemory: memoryGiB },
  });
  Object.defineProperty(globalThis, "postMessage", {
    configurable: true, value: (message: OpticalFlowWorkerResponse) => messages.push(message),
  });

  try {
    // Load the actual worker for its onmessage registration side effect.
    jest.requireActual("./optical-flow.worker");
    const scope = globalThis as unknown as ParentScope;
    if (!scope.onmessage) throw new Error("Optical Flow worker did not install onmessage.");
    await scope.onmessage({ data: { type: "warmup", requestId: 1 } } as MessageEvent<OpticalFlowWorkerRequest>);

    const width = 7;
    const height = 3;
    const previous = new Uint16Array(width * height * 3);
    const next = new Uint16Array(width * height * 3);
    for (let c = 0; c < 3; c += 1) {
      previous[(width + 2) * 3 + c] = 8000;
      next[(width + 4) * 3 + c] = 8000;
    }
    await scope.onmessage({
      data: {
        type: "interpolate", requestId: 2, width, height,
        variant: "mid", ...(additionalVariant ? { additionalVariant } : {}),
        previousGamma2Buffer: previous.buffer, nextGamma2Buffer: next.buffer,
        ...(sharedGray ? {
          previousGrayBuffer: new Uint8Array(width * height).fill(41).buffer,
          nextGrayBuffer: new Uint8Array(width * height).fill(99).buffer,
        } : {}),
      },
    } as MessageEvent<OpticalFlowWorkerRequest>);
    return { messages, spawned, flowComputations, seenGrays };
  } finally {
    for (const [key, descriptor] of [
      ["Worker", originalWorker],
      ["navigator", originalNavigator],
      ["onmessage", originalOnmessage],
      ["postMessage", originalPostMessage],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

describe("Optical Flow quality-preserving native Flow parallelization", () => {
  test.each([
    { cores: 8, memoryGiB: 8, workerCount: 2 },
    { cores: 2, memoryGiB: 8, workerCount: 1 },
    { cores: 8, memoryGiB: 4, workerCount: 1 },
  ])("$workerCount native worker(s) preserve the moved midpoint peak", async ({ cores, memoryGiB, workerCount }) => {
    const { messages, spawned } = await runMidpoint(cores, memoryGiB);
    expect(spawned).toBe(workerCount);
    expect(messages.find((message) => message.type === "ready")).toMatchObject({
      type: "ready", requestId: 1, flowWorkerCount: workerCount,
    });
    const output = messages.find((message) => message.type === "result");
    expect(output?.type).toBe("result");
    if (!output || output.type !== "result") return;
    expect(output.performance.flowWorkerCount).toBe(workerCount);
    const pixels = new Uint16Array(output.gamma2Buffer);
    const expected = new Uint16Array(7 * 3 * 3);
    expected.fill(0);
    for (let c = 0; c < 3; c += 1) expected[(7 + 3) * 3 + c] = 8000;
    expect(Array.from(pixels)).toEqual(Array.from(expected));
  });
});

// The per-frame interpolation uses canonical gamma-2 RGB16 with extended
// 0..4 linear range. Warping must not clamp samples at the 0..1 boundary.
test("STF range-4 warp preserves highlights above linear 1", async () => {
  jest.resetModules();
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalOnmessage = Object.getOwnPropertyDescriptor(globalThis, "onmessage");
  const originalPost = Object.getOwnPropertyDescriptor(globalThis, "postMessage");
  const responses: OpticalFlowWorkerResponse[] = [];
  class ZeroFlowDirection {
    onmessage: ((event: MessageEvent<OpticalFlowDirectionResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    postMessage(req: OpticalFlowDirectionRequest) {
      const zero = new Float32Array(req.type === "init" ? 0 : req.width * req.height * 2);
      const response: OpticalFlowDirectionResponse = req.type === "init"
        ? { type: "ready", requestId: req.requestId }
        : req.type === "compute-pair"
          ? { type: "pair-result", requestId: req.requestId, forwardBuffer: zero.buffer,
              backwardBuffer: zero.slice().buffer, forwardMs: 0, backwardMs: 0 }
          : { type: "result", requestId: req.requestId, flowBuffer: zero.buffer, computeMs: 0 };
      queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<OpticalFlowDirectionResponse>));
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: ZeroFlowDirection });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {hardwareConcurrency: 2, deviceMemory: 4} });
  Object.defineProperty(globalThis, "postMessage", { configurable: true, value: (m: OpticalFlowWorkerResponse) => responses.push(m) });
  try {
    jest.requireActual("./optical-flow.worker");
    const scope = globalThis as unknown as ParentScope;
    const src = new Uint16Array([54000, 53000, 52000]); // In range 4 this is > linear 1.
    await scope.onmessage?.({data: {type:"interpolate", requestId: 99, variant:"mid", linearRangeMax:4,
      previousImageId:0, nextImageId:1, width:1, height:1,
      previousGamma2Buffer:src.slice().buffer, nextGamma2Buffer:src.slice().buffer}} as MessageEvent<OpticalFlowWorkerRequest>);
    const result=responses.find((m)=>m.type==="result");
    expect(result?.type).toBe("result");
    if(result?.type==="result") expect(Array.from(new Uint16Array(result.gamma2Buffer))).toEqual(Array.from(src));
  } finally {
    for(const [key, value] of [["Worker",originalWorker],["navigator",originalNavigator],
      ["onmessage",originalOnmessage],["postMessage",originalPost]] as const) {
      if(value) Object.defineProperty(globalThis,key,value); else Reflect.deleteProperty(globalThis,key);
    }
  }
});


describe("STF Phase 3 — reuse one bidirectional Flow for midpoint and outer warp", () => {
  test.each([
    { extra: "ext1" as const, outputX: 0 },
    { extra: "ext2" as const, outputX: 6 },
  ])("mid + $extra are distinct full-resolution frames with just two direction computations", async ({extra, outputX}) => {
    const { messages, spawned, flowComputations } = await runMidpoint(8, 8, extra);
    expect(spawned).toBe(2);
    expect(flowComputations).toBe(2); // forward + backward, not twice per frame
    const response = messages.find((message) => message.type === "result");
    expect(response?.type).toBe("result");
    if (!response || response.type !== "result") return;
    expect(response.additionalGamma2Buffer).toBeInstanceOf(ArrayBuffer);
    expect(response.performance.additionalWarpMs).toBeGreaterThanOrEqual(0);
    const mid = new Uint16Array(response.gamma2Buffer);
    const ext = new Uint16Array(response.additionalGamma2Buffer!);
    expect(mid[(7 + 3) * 3]).toBe(8000);
    expect(ext[(7 + outputX) * 3]).toBe(8000);
    expect(ext[(7 + 3) * 3]).toBe(0);
  });
});


test("STF Phase 4 supplies shared Gray8 proxies to both native Flow directions", async () => {
  const { messages, seenGrays } = await runMidpoint(8, 8, undefined, true);
  expect(messages.find((message) => message.type === "result")?.type).toBe("result");
  expect(seenGrays).toEqual([[41, 99], [99, 41]]);
});
