import { StfOpticalFlowClient } from "./stf-optical-flow-client";
import type { OpticalFlowWorkerRequest, OpticalFlowWorkerResponse } from "../workers/protocols/optical-flow-protocol";

test("STF Flow client passes geometric inverse-warp scales through both Worker request paths", async () => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const sent: OpticalFlowWorkerRequest[] = [];
  const width = 2;
  const height = 2;
  const inverseScale = 4.024;

  class FakeWorker {
    onmessage: ((event: MessageEvent<OpticalFlowWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    readonly url: string;
    constructor(url: string | URL) { this.url = String(url); }
    postMessage(request: OpticalFlowWorkerRequest) {
      sent.push(request);
      queueMicrotask(() => {
        if (request.type === "interpolate") {
          this.onmessage?.({ data: {
            type: "result", requestId: request.requestId, width, height,
            gamma2Buffer: new Uint16Array(width * height * 3).buffer,
            additionalGamma2Buffer: new Uint16Array(width * height * 3).buffer,
            flowWidth: width, flowHeight: height,
            performance: { flowWorkerCount: 2 },
          } } as MessageEvent<OpticalFlowWorkerResponse>);
        } else if (request.type === "warp-retained") {
          this.onmessage?.({ data: {
            type: "warp-result", requestId: request.requestId, width, height,
            gamma2Buffer: new Uint16Array(width * height * 3).buffer, warpMs: 1,
          } } as MessageEvent<OpticalFlowWorkerResponse>);
        }
      });
    }
    terminate() {}
  }

  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  Object.defineProperty(globalThis, "window", {
    configurable: true, value: { location: { origin: "https://stgy.example" } },
  });
  try {
    const client = new StfOpticalFlowClient();
    try {
      const prev = new Uint16Array(width * height * 3);
      const next = new Uint16Array(width * height * 3);
      await client.generate(width, height, 0, 1, prev, next,
        "mid", undefined, "ext1-10", inverseScale, true, true, "session-a", 1700000000000, "align-1");
      await client.warpRetained(width, height, 0, 1, "ext1-10", inverseScale);
      expect(sent).toHaveLength(2);
      expect(sent[0]).toMatchObject({
        type: "interpolate", variant: "mid", additionalVariant: "ext1-10",
        additionalVariantScale: inverseScale, retainPair: true, persistFlow: true,
        sessionId: "session-a", sessionCreatedAt: 1700000000000, alignmentKey: "align-1",
      });
      expect(sent[1]).toMatchObject({
        type: "warp-retained", variant: "ext1-10", variantScale: inverseScale,
        previousImageId: 0, nextImageId: 1,
      });
    } finally {
      client.terminate();
    }
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
