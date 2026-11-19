import { StfOpticalFlowClient } from "./stf-optical-flow-client";
import type { OpticalFlowWorkerRequest, OpticalFlowWorkerResponse } from "../workers/protocols/optical-flow-protocol";

test("STF Flow client passes geometric inverse-warp scales through active Worker request paths", async () => {
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
        } else if (request.type === "warp-opening-average") {
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
        "mid", undefined, "ext2", inverseScale, true, "session-a", 1700000000000, "align-1", undefined, 31);
      await client.warpOpeningAverage(width, height, 0, "ext1-12", inverseScale, prev);
      expect(sent).toHaveLength(2);
      expect(sent[0]).toMatchObject({
        type: "interpolate", variant: "mid", additionalVariant: "ext2",
        additionalVariantScale: inverseScale, persistFlow: true, winsize: 31,
        sessionId: "session-a", sessionCreatedAt: 1700000000000, alignmentKey: "align-1",
      });
      expect(sent[1]).toMatchObject({
        type: "warp-opening-average", variant: "ext1-12", variantScale: inverseScale,
        sourceImageId: 0,
      });
      const openingRequest = sent[1];
      if (openingRequest.type !== "warp-opening-average") {
        throw new Error("Expected opening Average Flow request");
      }
      const sourceBuffer = openingRequest.sourceGamma2Buffer;
      expect(Object.prototype.toString.call(sourceBuffer)).toBe("[object ArrayBuffer]");
      expect(sourceBuffer?.byteLength).toBe(prev.byteLength);
      expect(sourceBuffer).not.toBe(prev.buffer);
      expect(new Uint16Array(sourceBuffer)).toEqual(prev);
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

test("STF Flow transfers only explicitly owned full RGB16 buffers", async () => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const messages: Array<{ request: OpticalFlowWorkerRequest; transfer: Transferable[] }> = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<OpticalFlowWorkerResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    postMessage(request: OpticalFlowWorkerRequest, transfer: Transferable[] = []) {
      messages.push({ request, transfer });
      queueMicrotask(() => {
        if (request.type === "interpolate") {
          this.onmessage?.({ data: {
            type: "result", requestId: request.requestId, width: 2, height: 2,
            gamma2Buffer: new Uint16Array(12).buffer,
            flowWidth: 2, flowHeight: 2, performance: { flowWorkerCount: 1 },
          } } as MessageEvent<OpticalFlowWorkerResponse>);
        } else if (request.type === "warp-opening-average") {
          this.onmessage?.({ data: {
            type: "warp-result", requestId: request.requestId, width: 2, height: 2,
            gamma2Buffer: new Uint16Array(12).buffer, warpMs: 1,
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
      const previous = Uint16Array.from({ length: 12 }, (_, i) => i + 1);
      const next = Uint16Array.from({ length: 12 }, (_, i) => i + 101);
      await client.generate(2, 2, 0, 1, previous, next, "mid", undefined,
        undefined, undefined, false, undefined, undefined, undefined, undefined, 31,
        { previous: true });
      const request = messages[0].request;
      if (request.type !== "interpolate") throw new Error("Expected interpolate request");
      expect(request.previousGamma2Buffer).toBe(previous.buffer);
      expect(request.nextGamma2Buffer).not.toBe(next.buffer);
      expect(Array.from(new Uint16Array(request.nextGamma2Buffer))).toEqual(Array.from(next));
      expect(messages[0].transfer).toEqual([previous.buffer, request.nextGamma2Buffer]);

      // A view onto part of an owned allocation must still copy, otherwise the
      // Worker would receive extra pixels outside that view.
      const backing = new Uint16Array(16);
      const sliced = backing.subarray(2, 14);
      await client.generate(2, 2, 0, 1, sliced, next, "mid", undefined,
        undefined, undefined, false, undefined, undefined, undefined, undefined, 31,
        { previous: true, next: true });
      const slicedRequest = messages[1].request;
      if (slicedRequest.type !== "interpolate") throw new Error("Expected interpolate request");
      expect(slicedRequest.previousGamma2Buffer).not.toBe(backing.buffer);
      expect(slicedRequest.previousGamma2Buffer.byteLength).toBe(sliced.byteLength);
      expect(slicedRequest.nextGamma2Buffer).toBe(next.buffer);

      const source = new Uint16Array(12).fill(123);
      await client.warpOpeningAverage(2, 2, 0, "ext1", 1, source, true);
      const opening = messages[2].request;
      if (opening.type !== "warp-opening-average") throw new Error("Expected warp request");
      expect(opening.sourceGamma2Buffer).toBe(source.buffer);
      expect(messages[2].transfer).toEqual([source.buffer]);
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
