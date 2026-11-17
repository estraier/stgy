import type {
  OpticalFlowOpeningVariant,
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

function syntheticField(width: number, height: number, dx: number, norms?: readonly number[]): ArrayBuffer {
  const values = new Float32Array(width * height * 2);
  for (let i = 0; i < values.length; i += 2) values[i] = norms ? Math.sign(dx) * norms[i / 2] : dx;
  return values.buffer;
}

async function runMidpoint(cores: number, memoryGiB: number, additionalVariant?: "ext1" | "ext2", sharedGray = false,
  retainedVariants: OpticalFlowOpeningVariant[] = [],
  scales?: { main?: number; additional?: number; retained?: number[] },
  norms?: readonly number[]) {
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
          flowBuffer: syntheticField(message.width, message.height, this.index === 0 ? 2 : -2, norms),
          computeMs: 1,
        });
      } else if (message.type === "compute-pair") {
        seenGrays.push([new Uint8Array(message.previousGrayBuffer)[0], new Uint8Array(message.nextGrayBuffer)[0]]);
        flowComputations += 2;
        respond({
          type: "pair-result", requestId: message.requestId,
          forwardBuffer: syntheticField(message.width, message.height, 2, norms),
          backwardBuffer: syntheticField(message.width, message.height, -2, norms),
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

    const width = retainedVariants.length ? 11 : 7;
    const height = 3;
    const startPeak = retainedVariants.length ? 5 : 2;
    const previous = new Uint16Array(width * height * 3);
    const next = new Uint16Array(width * height * 3);
    for (let c = 0; c < 3; c += 1) {
      previous[(width + startPeak) * 3 + c] = 8000;
      next[(width + startPeak + 2) * 3 + c] = 8000;
    }
    await scope.onmessage({
      data: {
        type: "interpolate", requestId: 2, width, height,
        variant: "mid", ...(additionalVariant ? { additionalVariant } : {}),
        ...(scales?.main !== undefined ? { variantScale: scales.main } : {}),
        ...(scales?.additional !== undefined ? { additionalVariantScale: scales.additional } : {}),
        ...(retainedVariants.length ? { retainPair: true, previousImageId: 12, nextImageId: 13 } : {}),
        previousGamma2Buffer: previous.buffer, nextGamma2Buffer: next.buffer,
        ...(sharedGray ? {
          previousGrayBuffer: new Uint8Array(width * height).fill(41).buffer,
          nextGrayBuffer: new Uint8Array(width * height).fill(99).buffer,
        } : {}),
      },
    } as MessageEvent<OpticalFlowWorkerRequest>);
    for (let i = 0; i < retainedVariants.length; i++) {
      await scope.onmessage({ data: { type: "warp-retained", requestId: 3 + i,
        previousImageId: 12, nextImageId: 13, variant: retainedVariants[i],
        ...(scales?.retained?.[i] !== undefined ? { variantScale: scales.retained[i] } : {}) },
      } as MessageEvent<OpticalFlowWorkerRequest>);
    }
    if (retainedVariants.length) {
      await scope.onmessage({ data: { type: "release-retained", requestId: 99 } } as MessageEvent<OpticalFlowWorkerRequest>);
      await scope.onmessage({ data: { type: "warp-retained", requestId: 100,
        previousImageId: 12, nextImageId: 13, variant: "ext1" },
      } as MessageEvent<OpticalFlowWorkerRequest>);
    }
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

test("STF Worker accepts retained extrapolation steps 9 and 12 without recomputing Flow", async () => {
  const { messages, flowComputations } = await runMidpoint(8, 8, undefined, true,
    ["ext1-9", "ext1-12"], { retained: [5.5, 7.2] });
  expect(flowComputations).toBe(2);
  for (const id of [3, 4]) {
    const result = messages.find((message) => message.requestId === id);
    expect(result?.type).toBe("warp-result");
    if (result?.type === "warp-result") {
      expect(new Uint16Array(result.gamma2Buffer).length).toBe(11 * 3 * 3);
    }
  }
  expect(messages.find((message) => message.requestId === 100)?.type).toBe("error");
});

test("P5-P10 gate protects small-flow pixels in opening and closing extrapolation but not interpolation", async () => {
  // 11x3 Flow; the smallest vectors occupy both highlighted locations. P5
  // falls on 0.08, P10 on 0.2, so the 0.08px warp is suppressed.
  const norms = new Array(33).fill(2);
  norms[0] = 0.05;
  norms[1] = 0.1;
  norms[2] = 0.2;
  norms[16] = 0.08; // previous image peak (x=5, y=1)
  norms[18] = 0.08; // next image peak (x=7, y=1)
  // A uniform field has P5==P10, so it takes the old warp path.
  const controlNorms = new Array(33).fill(0.08);
  for (const variant of ["ext1", "ext2"] as const) {
    const gated = await runMidpoint(8, 8, variant, false, ["ext1-2"],
      { additional: 1, retained: [2] }, norms);
    const control = await runMidpoint(8, 8, variant, false, ["ext1-2"],
      { additional: 1, retained: [2] }, controlNorms);
    const generated = gated.messages.find((message) => message.requestId === 2 && message.type === "result");
    const oldWarp = control.messages.find((message) => message.requestId === 2 && message.type === "result");
    expect(generated?.type).toBe("result");
    expect(oldWarp?.type).toBe("result");
    if (generated?.type !== "result" || oldWarp?.type !== "result") continue;
    const pixelIndex = ((11 + (variant === "ext1" ? 5 : 7)) * 3);
    const pixels = new Uint16Array(generated.additionalGamma2Buffer!);
    const oldPixels = new Uint16Array(oldWarp.additionalGamma2Buffer!);
    expect(pixels[pixelIndex]).toBe(8000);
    expect(oldPixels[pixelIndex]).toBeLessThan(8000);
    if (variant === "ext1") {
      const retained = gated.messages.find((message) => message.requestId === 3 && message.type === "warp-result");
      expect(retained?.type).toBe("warp-result");
      if (retained?.type === "warp-result") {
        // Reusing the same P5/P10 gate at a larger virtual-F scale must not
        // resurrect the suppressed sub-threshold displacement.
        expect(new Uint16Array(retained.gamma2Buffer)[pixelIndex]).toBe(8000);
      }
    }
    // The interpolation output uses the same raw Flow regardless of whether
    // an additional extrapolated frame is also requested.
    const onlyMiddle = await runMidpoint(8, 8, undefined, false, ["ext1-2"],
      { retained: [2] }, norms);
    const midpoint = onlyMiddle.messages.find((message) => message.requestId === 2 && message.type === "result");
    expect(midpoint?.type).toBe("result");
    if (midpoint?.type === "result") {
      expect(Array.from(new Uint16Array(generated.gamma2Buffer)))
        .toEqual(Array.from(new Uint16Array(midpoint.gamma2Buffer)));
    }
  }
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
  test("correct inverse-geometry factors are honored for retained opening warps", async () => {
    const ratio = 2 ** (1 / 6);
    const scales = [1, 2, 3].map((step) =>
      (1 - 2 ** (-step / 12)) / (1 - 1 / ratio));
    const { messages, flowComputations } = await runMidpoint(8, 8, undefined, false,
      ["ext1", "ext1-2", "ext1-3"], { retained: scales });
    expect(flowComputations).toBe(2);
    const warpResults = messages.filter((message) => message.type === "warp-result");
    expect(warpResults).toHaveLength(3);
    const expectedXs = [4, 3, 2];
    warpResults.forEach((response, i) => {
      if (response.type !== "warp-result") return;
      const image = new Uint16Array(response.gamma2Buffer);
      const row = Array.from({ length: 11 }, (_, x) => image[(11 + x) * 3]);
      expect(row.indexOf(Math.max(...row))).toBe(expectedXs[i]);
      expect(row[expectedXs[i]]).toBeGreaterThan(3000);
    });
  });
  test.each([
    { extra: "ext1" as const, outputX: 1 },
    { extra: "ext2" as const, outputX: 5 },
  ])("mid + $extra are distinct half-step outer frames with just two direction computations", async ({extra, outputX}) => {
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


test("STF expanded extrapolation reuses one Flow for 0.5 / 1 / 1.5 opening half-steps", async () => {
  const variants = ["ext1", "ext1-2", "ext1-3"] as const;
  const { messages, flowComputations } = await runMidpoint(8, 8, undefined, true, [...variants]);
  expect(flowComputations).toBe(2); // once each direction, not once per output
  const videoWidth = 11;
  for (let i = 0; i < variants.length; i++) {
    const response = messages.find((message) => message.requestId === i + 3);
    expect(response?.type).toBe("warp-result");
    if (!response || response.type !== "warp-result") continue;
    const image = new Uint16Array(response.gamma2Buffer);
    const sourcePeak = 5;
    const expectedX = sourcePeak - (i + 1);
    expect(image[(videoWidth + expectedX) * 3]).toBe(8000);
    expect(image[(videoWidth + sourcePeak) * 3]).toBe(0);
  }
  const released = messages.find((message) => message.requestId === 100);
  expect(released?.type).toBe("error");
});


test("STF inverse-warp extrapolation expands a synthetic CoC at the geometrically requested radius", async () => {
  // Regression: the previous geometrical patch passed a *forward* displacement
  // multiplier into this *backward* sampler. Test the actual Worker response,
  // including its retained-pair path, instead of asserting factors alone.
  jest.resetModules();
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldOnmessage = Object.getOwnPropertyDescriptor(globalThis, "onmessage");
  const oldPostMessage = Object.getOwnPropertyDescriptor(globalThis, "postMessage");
  const width = 161;
  const height = 161;
  const center = 80;
  const firstF = 2;
  const nextF = 2 * 2 ** (1 / 6);
  const radius = 40;
  const ratio = firstF / nextF;
  const gamma2Value = 10000;
  const responseMessages: OpticalFlowWorkerResponse[] = [];
  let directionComputations = 0;

  const radialField = (scale: number): ArrayBuffer => {
    const vectors = new Float32Array(width * height * 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 2;
        // An out-of-focus object need not occupy the whole image. Keep a
        // static strip away from the test disc, so P5==P10==0 and this test
        // continues to cover unmodified inverse-warp geometry.
        if (y < 30) continue;
        vectors[offset] = (x - center) * (scale - 1);
        vectors[offset + 1] = (y - center) * (scale - 1);
      }
    }
    return vectors.buffer;
  };
  const disc = (discRadius: number): Uint16Array => {
    const pixels = new Uint16Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.hypot(x - center, y - center) > discRadius) continue;
        const offset = (y * width + x) * 3;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = gamma2Value;
      }
    }
    return pixels;
  };
  const measuredRadius = (pixels: Uint16Array): number => {
    let outerRadius = 0;
    for (let x = center; x < width; x++) {
      if (pixels[(center * width + x) * 3] > gamma2Value / 2) outerRadius = x - center;
    }
    return outerRadius;
  };

  class RadialDirectionWorker {
    onmessage: ((event: MessageEvent<OpticalFlowDirectionResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    postMessage(message: OpticalFlowDirectionRequest) {
      const respond = (reply: OpticalFlowDirectionResponse) =>
        queueMicrotask(() => this.onmessage?.({ data: reply } as MessageEvent<OpticalFlowDirectionResponse>));
      if (message.type === "init") {
        respond({ type: "ready", requestId: message.requestId });
      } else if (message.type === "compute-pair") {
        directionComputations += 2;
        respond({ type: "pair-result", requestId: message.requestId,
          forwardBuffer: radialField(ratio), backwardBuffer: radialField(1 / ratio),
          forwardMs: 0, backwardMs: 0 });
      } else {
        throw new Error(`Unexpected radial Flow Worker request: ${message.type}`);
      }
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: RadialDirectionWorker });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { hardwareConcurrency: 2, deviceMemory: 4 },
  });
  Object.defineProperty(globalThis, "postMessage", {
    configurable: true, value: (message: OpticalFlowWorkerResponse) => responseMessages.push(message),
  });
  try {
    jest.requireActual("./optical-flow.worker");
    const scope = globalThis as unknown as ParentScope;
    if (!scope.onmessage) throw new Error("STF Optical Flow Worker onmessage is missing");
    await scope.onmessage({ data: { type: "interpolate", requestId: 300,
      width, height, variant: "mid", retainPair: true,
      previousImageId: 8, nextImageId: 9,
      previousGamma2Buffer: disc(radius).buffer,
      nextGamma2Buffer: disc(radius * ratio).buffer,
    } } as MessageEvent<OpticalFlowWorkerRequest>);

    const results: number[] = [];
    for (const step of [1, 2, 3, 10]) {
      const virtualF = firstF * 2 ** (-step / 12);
      const inverseScale = (virtualF / firstF - 1) / (firstF / nextF - 1);
      await scope.onmessage({ data: { type: "warp-retained", requestId: 300 + step,
        previousImageId: 8, nextImageId: 9,
        variant: step === 1 ? "ext1" : `ext1-${step}` as "ext1-2" | "ext1-3" | "ext1-10",
        variantScale: inverseScale,
      } } as MessageEvent<OpticalFlowWorkerRequest>);
      const response = responseMessages.find((entry) =>
        entry.type === "warp-result" && entry.requestId === 300 + step);
      expect(response?.type).toBe("warp-result");
      if (!response || response.type !== "warp-result") continue;
      const measured = measuredRadius(new Uint16Array(response.gamma2Buffer));
      const target = radius * firstF / virtualF;
      expect(Math.abs(measured - target)).toBeLessThanOrEqual(1.5);
      results.push(measured);
    }
    expect(results).toEqual([42, 45, 48, 72]);
    // The closing half-step uses the *last* real RGB16 frame with the
    // backward (last -> previous) Flow; its radius must shrink, not expand.
    const closingF = nextF * Math.sqrt(nextF / firstF);
    const closingInverseScale = (closingF / nextF - 1) / (nextF / firstF - 1);
    await scope.onmessage({ data: { type: "warp-retained", requestId: 340,
      previousImageId: 8, nextImageId: 9, variant: "ext2",
      variantScale: closingInverseScale,
    } } as MessageEvent<OpticalFlowWorkerRequest>);
    const closingResult = responseMessages.find((entry) =>
      entry.type === "warp-result" && entry.requestId === 340);
    expect(closingResult?.type).toBe("warp-result");
    if (closingResult?.type === "warp-result") {
      const actualClosingRadius = measuredRadius(new Uint16Array(closingResult.gamma2Buffer));
      const expectedClosingRadius = radius * firstF / closingF;
      expect(Math.abs(actualClosingRadius - expectedClosingRadius)).toBeLessThanOrEqual(1.5);
      expect(actualClosingRadius).toBeLessThan(radius * firstF / nextF);
    }
    // All opening and closing warps reuse the one already computed real pair.
    expect(directionComputations).toBe(2);
  } finally {
    for (const [key, descriptor] of [
      ["Worker", oldWorker], ["navigator", oldNavigator],
      ["onmessage", oldOnmessage], ["postMessage", oldPostMessage],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("STF opening extrapolation 12 expands a synthetic disc to its 1/F target radius", async () => {
  // Keep the target disc entirely in frame: for a 1/3-stop real pair, the
  // 12th virtual half-step doubles the source disc radius.
  jest.resetModules();
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldOnmessage = Object.getOwnPropertyDescriptor(globalThis, "onmessage");
  const oldPostMessage = Object.getOwnPropertyDescriptor(globalThis, "postMessage");
  const width = 161;
  const height = 161;
  const center = 80;
  const radius = 10;
  const firstF = 2;
  const nextF = 2 * 2 ** (1 / 6);
  const realRadiusRatio = firstF / nextF;
  const gamma2Value = 10000;
  const responses: OpticalFlowWorkerResponse[] = [];
  let bidirectionalComputations = 0;
  const radialField = (scale: number): ArrayBuffer => {
    const vectors = new Float32Array(width * height * 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 2;
        // An out-of-focus object need not occupy the whole image. Keep a
        // static strip away from the test disc, so P5==P10==0 and this test
        // continues to cover unmodified inverse-warp geometry.
        if (y < 30) continue;
        vectors[offset] = (x - center) * (scale - 1);
        vectors[offset + 1] = (y - center) * (scale - 1);
      }
    }
    return vectors.buffer;
  };
  const disc = (r: number): Uint16Array => {
    const pixels = new Uint16Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.hypot(x - center, y - center) <= r) {
          const offset = (y * width + x) * 3;
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = gamma2Value;
        }
      }
    }
    return pixels;
  };
  class RadialDirectionWorker {
    onmessage: ((event: MessageEvent<OpticalFlowDirectionResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    postMessage(message: OpticalFlowDirectionRequest) {
      const respond = (result: OpticalFlowDirectionResponse) =>
        queueMicrotask(() => this.onmessage?.({ data: result } as MessageEvent<OpticalFlowDirectionResponse>));
      if (message.type === "init") {
        respond({ type: "ready", requestId: message.requestId });
      } else if (message.type === "compute-pair") {
        bidirectionalComputations += 2;
        respond({ type: "pair-result", requestId: message.requestId,
          forwardBuffer: radialField(realRadiusRatio), backwardBuffer: radialField(1 / realRadiusRatio),
          forwardMs: 0, backwardMs: 0 });
      } else {
        throw new Error(`Unexpected radial Flow operation ${message.type}`);
      }
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: RadialDirectionWorker });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { hardwareConcurrency: 2, deviceMemory: 4 },
  });
  Object.defineProperty(globalThis, "postMessage", {
    configurable: true, value: (message: OpticalFlowWorkerResponse) => responses.push(message),
  });
  try {
    jest.requireActual("./optical-flow.worker");
    const scope = globalThis as unknown as ParentScope;
    if (!scope.onmessage) throw new Error("Optical Flow worker request handler missing");
    await scope.onmessage({ data: {
      type: "interpolate", requestId: 500, width, height, variant: "mid",
      retainPair: true, previousImageId: 9, nextImageId: 10,
      previousGamma2Buffer: disc(radius).buffer,
      nextGamma2Buffer: disc(radius * realRadiusRatio).buffer,
    } } as MessageEvent<OpticalFlowWorkerRequest>);
    for (const step of [4, 9, 12]) {
      const virtualF = firstF * 2 ** (-step / 12);
      const inverseWarpScale = (1 - virtualF / firstF) / (1 - firstF / nextF);
      await scope.onmessage({ data: {
        type: "warp-retained", requestId: 500 + step, previousImageId: 9, nextImageId: 10,
        variant: `ext1-${step}` as OpticalFlowOpeningVariant, variantScale: inverseWarpScale,
      } } as MessageEvent<OpticalFlowWorkerRequest>);
      const response = responses.find((item) => item.requestId === 500 + step);
      expect(response?.type).toBe("warp-result");
      if (response?.type !== "warp-result") continue;
      const pixels = new Uint16Array(response.gamma2Buffer);
      let measuredRadius = 0;
      for (let x = center; x < width; x++) {
        if (pixels[(center * width + x) * 3] > gamma2Value / 2) measuredRadius = x - center;
      }
      // A 10-pixel discrete source disc has a quantized threshold edge; the
      // expanded edge may deviate by a few pixels after bilinear sampling.
      expect(Math.abs(measuredRadius - radius * firstF / virtualF)).toBeLessThanOrEqual(3);
    }
    expect(bidirectionalComputations).toBe(2);
  } finally {
    for (const [name, descriptor] of [
      ["Worker", oldWorker], ["navigator", oldNavigator],
      ["onmessage", oldOnmessage], ["postMessage", oldPostMessage],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
