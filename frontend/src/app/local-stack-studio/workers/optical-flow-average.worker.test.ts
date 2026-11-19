import type { OpticalFlowDirectionRequest, OpticalFlowDirectionResponse } from "./protocols/optical-flow-direction-protocol";
import type { OpticalFlowWorkerRequest, OpticalFlowWorkerResponse } from "./protocols/optical-flow-protocol";

const width = 48;
const height = 8;

function constantFlow(dx: number): ArrayBuffer {
  const buffer = new Float32Array(width * height * 2);
  for (let i = 0; i < buffer.length; i += 2) buffer[i] = dx;
  return buffer.buffer;
}

function gradient(): Uint16Array {
  const rgb = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const base = (y * width + x) * 3;
    rgb[base] = rgb[base + 1] = rgb[base + 2] = x * 200;
  }
  return rgb;
}

test("opening Average Flow uses equal weights from three radius-scaled pairs without additional Farneback", async () => {
  jest.resetModules();
  const originals = Object.fromEntries(["Worker", "navigator", "postMessage", "onmessage"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const emitted: OpticalFlowWorkerResponse[] = [];
  const originalFlow = [8, 2, 1];
  let flowCalculations = 0;

  class FakeDirectionWorker {
    onmessage: ((event: MessageEvent<OpticalFlowDirectionResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage(request: OpticalFlowDirectionRequest) {
      if (request.type === "init") {
        const response: OpticalFlowDirectionResponse = { type: "ready", requestId: request.requestId };
        queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<OpticalFlowDirectionResponse>));
        return;
      }
      if (request.type !== "compute-pair") throw new Error("Unexpected native Flow request");
      const movement = originalFlow[flowCalculations++];
      if (movement === undefined) throw new Error("Average requested extra Farneback computation");
      const response: OpticalFlowDirectionResponse = {
        type: "pair-result", requestId: request.requestId,
        forwardBuffer: constantFlow(movement), backwardBuffer: constantFlow(-movement),
        forwardMs: 1, backwardMs: 1,
      };
      queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<OpticalFlowDirectionResponse>));
    }
    terminate() {}
  }

  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeDirectionWorker });
  Object.defineProperty(globalThis, "navigator", { configurable: true,
    value: { hardwareConcurrency: 2, deviceMemory: 8 } });
  Object.defineProperty(globalThis, "postMessage", { configurable: true,
    value: (response: OpticalFlowWorkerResponse) => emitted.push(response) });
  try {
    jest.requireActual("./optical-flow.worker");
    const scope = globalThis as unknown as {
      onmessage: ((event: MessageEvent<OpticalFlowWorkerRequest>) => Promise<void>) | null;
    };
    if (!scope.onmessage) throw new Error("STF Flow worker handler missing");
    const send = async (request: OpticalFlowWorkerRequest): Promise<OpticalFlowWorkerResponse> => {
      const count = emitted.length;
      await scope.onmessage!({ data: request } as MessageEvent<OpticalFlowWorkerRequest>);
      const response = emitted.slice(count).find((item) => item.requestId === request.requestId && item.type !== "progress");
      if (!response || response.type === "error") throw new Error(response?.type === "error" ? response.message : "Missing Worker result");
      return response;
    };

    for (let pair = 0; pair < 3; pair++) {
      const result = await send({
        type: "interpolate", requestId: pair + 1, width, height, variant: "mid",
        previousImageId: pair, nextImageId: pair + 1,
        previousGamma2Buffer: gradient().buffer, nextGamma2Buffer: gradient().buffer,
        openingAverageRadiusSpan: [0.1, 0.05, 0.025][pair],
        ...(pair === 2 ? { additionalVariant: "ext2", additionalVariantScale: 1 } as const : {}),
      });
      expect(result.type).toBe("result");
      if (pair === 2 && result.type === "result") {
        // Closing ext2 must use this last pair's native backward Flow (-1px),
        // not the opening-side Average Flow (+5.33px).
        expect(Boolean(result.additionalGamma2Buffer)).toBe(true);
        expect(new Uint16Array(result.additionalGamma2Buffer!)[(4 * width + 10) * 3]).toBe(1800);
      }
    }
    expect(flowCalculations).toBe(3);
    const opening = await send({ type: "warp-opening-average", requestId: 10,
      sourceImageId: 0, sourceGamma2Buffer: gradient().buffer,
      variant: "ext1", variantScale: 1 });
    expect(opening.type).toBe("warp-result");
    if (opening.type !== "warp-result") return;
    // A-B is 8px; B-C and C-D predict 4px each. Average is (8+4+4)/3.
    const openingPixel = new Uint16Array(opening.gamma2Buffer)[(4 * width + 10) * 3];
    expect(openingPixel).toBeGreaterThan(2950);
    expect(openingPixel).toBeLessThan(3300);
    const later = await send({ type: "warp-opening-average", requestId: 11,
      sourceImageId: 0, variant: "ext1-12", variantScale: 2 });
    expect(later.type).toBe("warp-result");
    if (later.type === "warp-result") {
      expect(new Uint16Array(later.gamma2Buffer)[(4 * width + 10) * 3]).toBeGreaterThan(3500);
    }
    // Repeated opening variants reuse the retained Average Flow without
    // starting another Farneback calculation.
    const repeated = await send({ type: "warp-opening-average", requestId: 20,
      sourceImageId: 0, variant: "ext1", variantScale: 1 });
    expect(repeated.type).toBe("warp-result");
    if (repeated.type === "warp-result") {
      const pixel = new Uint16Array(repeated.gamma2Buffer)[(4 * width + 10) * 3];
      expect(pixel).toBeGreaterThan(2900);
      expect(pixel).toBeLessThan(3400);
    }
    expect(flowCalculations).toBe(3);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
