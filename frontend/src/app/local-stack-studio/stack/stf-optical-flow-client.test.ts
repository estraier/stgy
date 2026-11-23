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
      expect(new Uint16Array(sourceBuffer!)).toEqual(prev);

      // FS never uses the destination-indexed inverse multiplier for
      // forward projection. The two geometries must survive both API paths.
      const closingInverse = 0.48556;
      const closingForward = 0.45831;
      const openingForward = 9.16579;
      await client.generate(width, height, 0, 1, prev, next,
        "mid", undefined, "ext2", closingInverse,
        true, "session-a", 1700000000000, "align-1", undefined, 31, {},
        "forward-splat", undefined, closingForward);
      await client.warpOpeningAverage(width, height, 0, "ext1-12", inverseScale,
        prev, false, "forward-splat", openingForward);
      expect(sent).toHaveLength(4);
      expect(sent[2]).toMatchObject({
        type: "interpolate", variant: "mid", warpMethod: "forward-splat",
        additionalVariant: "ext2", additionalVariantScale: closingInverse,
        additionalForwardVariantScale: closingForward,
      });
      expect(sent[3]).toMatchObject({
        type: "warp-opening-average", warpMethod: "forward-splat",
        variant: "ext1-12", variantScale: inverseScale, forwardVariantScale: openingForward,
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

test("STF streamed RGB16 stripes are acknowledged after consumption, in order", async () => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const seen: string[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<OpticalFlowWorkerResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    private currentId = 0;
    private stage = 0;
    postMessage(request: OpticalFlowWorkerRequest) {
      const send = (response: OpticalFlowWorkerResponse) => queueMicrotask(() =>
        this.onmessage?.({ data: response } as MessageEvent<OpticalFlowWorkerResponse>));
      if (request.type === "interpolate") {
        expect(request.streamStripes).toBe(true);
        this.currentId = request.requestId;
        this.stage = 0;
        seen.push("request");
        send({ type: "stripe", requestId: request.requestId, kind: "primary",
          width: 2, height: 1, y: 0, gamma2Buffer: new Uint16Array(6).fill(123).buffer });
      } else if (request.type === "stripe-ack") {
        seen.push(`ack:${request.kind}:${request.y}`);
        expect(request.requestId).toBe(this.currentId);
        if (this.stage++ === 0) {
          send({ type: "stripe", requestId: request.requestId, kind: "primary",
            width: 2, height: 1, y: 1, gamma2Buffer: new Uint16Array(6).fill(456).buffer });
        } else if (this.stage === 2) {
          send({ type: "stripe", requestId: request.requestId, kind: "additional",
            width: 2, height: 2, y: 0, gamma2Buffer: new Uint16Array(12).fill(789).buffer });
        } else {
          send({ type: "stream-result", requestId: request.requestId, width: 2, height: 2,
            performance: { flowWorkerCount: 1 } as never });
        }
      }
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
      const result = await client.generateStripes({
        width: 2, height: 2, previousImageId: 0, nextImageId: 1,
        previousGamma2: new Uint16Array(12), nextGamma2: new Uint16Array(12),
        variant: "mid", additionalVariant: "ext2", additionalVariantScale: 1,
        sessionId: "s", sessionCreatedAt: 1, alignmentKey: "a", winsize: 31,
        inputOwnership: { previous: true, next: true },
      }, async (stripe) => {
        seen.push(`consume:${stripe.kind}:${stripe.y}:${stripe.pixels[0]}`);
        await Promise.resolve(); // Do not ack until the consumer finishes.
      });
      expect(result.flowWorkerCount).toBe(1);
      expect(seen).toEqual([
        "request", "consume:primary:0:123", "ack:primary:0",
        "consume:primary:1:456", "ack:primary:1",
        "consume:additional:0:789", "ack:additional:0",
      ]);
    } finally { client.terminate(); }
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("STF streaming rejects incomplete output rather than silently returning partial accumulation", async () => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  class FakeWorker {
    onmessage: ((event: MessageEvent<OpticalFlowWorkerResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    postMessage(request: OpticalFlowWorkerRequest) {
      if (request.type !== "warp-opening-average") return;
      queueMicrotask(() => this.onmessage?.({ data: {
        type: "stream-result", requestId: request.requestId, width: 2, height: 2, warpMs: 0,
      } } as MessageEvent<OpticalFlowWorkerResponse>));
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
      await expect(client.warpOpeningAverageStripes({
        width: 2, height: 2, sourceImageId: 0, variant: "ext1", variantScale: 1,
      }, () => {})).rejects.toThrow("without all stripes");
    } finally { client.terminate(); }
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("STF Flow client serializes two pipelined stripe callbacks and acks only after consumption", async () => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const seen: string[] = [];
  let resumeFirst: (() => void) | null = null;
  const firstGate = new Promise<void>((resolve) => { resumeFirst = resolve; });
  class FakeWorker {
    onmessage: ((event: MessageEvent<OpticalFlowWorkerResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    private acks = 0;
    postMessage(request: OpticalFlowWorkerRequest) {
      if (request.type === "interpolate") {
        for (let y = 0; y < 2; y++) {
          queueMicrotask(() => this.onmessage?.({ data: {
            type: "stripe", requestId: request.requestId, kind: "primary", width: 2, height: 1, y,
            gamma2Buffer: new Uint16Array(6).fill(100 + y).buffer,
          } } as MessageEvent<OpticalFlowWorkerResponse>));
        }
      } else if (request.type === "stripe-ack") {
        seen.push(`ack:${request.y}`);
        if (++this.acks === 2) queueMicrotask(() => this.onmessage?.({ data: {
          type: "stream-result", requestId: request.requestId, width: 2, height: 2,
          performance: { flowWorkerCount: 1 },
        } } as MessageEvent<OpticalFlowWorkerResponse>));
      }
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  Object.defineProperty(globalThis, "window", { configurable: true,
    value: { location: { origin: "https://stgy.example" } } });
  try {
    const client = new StfOpticalFlowClient();
    try {
      const task = client.generateStripes({
        width: 2, height: 2, previousImageId: 0, nextImageId: 1,
        previousGamma2: new Uint16Array(12), nextGamma2: new Uint16Array(12),
        variant: "mid", sessionId: "s", sessionCreatedAt: 1,
        alignmentKey: "a", winsize: 31, inputOwnership: {},
      }, async (stripe) => {
        seen.push(`consume:${stripe.y}`);
        if (stripe.y === 0) await firstGate;
      });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(seen).toEqual(["consume:0"]); // Second stripe must not overtake first.
      resumeFirst!();
      await task;
      expect(seen).toEqual(["consume:0", "ack:0", "consume:1", "ack:1"]);
    } finally { client.terminate(); }
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("STF Flow multi-interpolation stripes are acknowledged in stripe-major order before optional closing", async () => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const width = 2, height = 3;
  const events: Array<{ kind: string; middleIndex?: number; y: number }> = [];
  const middleFractions = [0.25, 0.5, 0.75];
  class FakeWorker {
    onmessage: ((event: MessageEvent<OpticalFlowWorkerResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    private step = 0;
    private requestId = 0;
    private readonly stripes = [
      ...[0, 2].flatMap((y) => middleFractions.map((_, middleIndex) =>
        ({ kind: "primary" as const, middleIndex, y, height: y === 0 ? 2 : 1 }))),
      { kind: "additional" as const, y: 0, height: 2 },
      { kind: "additional" as const, y: 2, height: 1 },
    ];
    private emitNext() {
      queueMicrotask(() => {
        const current = this.stripes[this.step];
        if (!current) {
          this.onmessage?.({ data: { type: "stream-result", requestId: this.requestId,
            width, height, performance: { flowWorkerCount: 2, flowWallMs: 1 } },
          } as MessageEvent<OpticalFlowWorkerResponse>);
          return;
        }
        this.onmessage?.({ data: { type: "stripe", requestId: this.requestId,
          ...current, width, gamma2Buffer: new Uint16Array(width * current.height * 3).buffer },
        } as MessageEvent<OpticalFlowWorkerResponse>);
      });
    }
    postMessage(request: OpticalFlowWorkerRequest) {
      if (request.type === "interpolate") {
        expect(request.middleFractions).toEqual(middleFractions);
        expect(request.streamStripes).toBe(true);
        this.requestId = request.requestId;
        this.emitNext();
      } else if (request.type === "stripe-ack") {
        const expected = this.stripes[this.step];
        expect(request.kind).toBe(expected.kind);
        expect(request.y).toBe(expected.y);
        if (expected.kind === "primary") expect(request.middleIndex).toBe(expected.middleIndex);
        this.step++;
        this.emitNext();
      }
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
      const pixels = new Uint16Array(width * height * 3);
      const performance = await client.generateStripes({
        width, height, previousImageId: 0, nextImageId: 1,
        previousGamma2: pixels, nextGamma2: pixels, variant: "mid", middleFractions,
        additionalVariant: "ext2", additionalVariantScale: 0.5,
        winsize: 31, sessionId: "s", sessionCreatedAt: 1, alignmentKey: "k", inputOwnership: {},
      }, (stripe) => { events.push({ kind: stripe.kind, middleIndex: stripe.middleIndex, y: stripe.y }); });
      expect(performance.flowWorkerCount).toBe(2);
      expect(performance.inputClonedBytes).toBe(pixels.byteLength * 2);
      expect(performance.inputCloneMs).toBeGreaterThanOrEqual(0);
      expect(performance.inputPostMs).toBeGreaterThanOrEqual(0);
      expect(events).toEqual([
        ...[0, 2].flatMap((y) => middleFractions.map((_, middleIndex) =>
          ({ kind: "primary", middleIndex, y }))),
        { kind: "additional", middleIndex: undefined, y: 0 },
        { kind: "additional", middleIndex: undefined, y: 2 },
      ]);
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

test.each([false, true])("STF Flow prefetch checks cache before preparing Gray8 (miss=%s)", async (miss) => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const seen: OpticalFlowWorkerRequest[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<OpticalFlowWorkerResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    postMessage(request: OpticalFlowWorkerRequest) {
      seen.push(request);
      queueMicrotask(() => {
        if (request.type === "prefetch-check") {
          const response: OpticalFlowWorkerResponse = {
            type: "prefetch-status", requestId: request.requestId, needsGray: miss,
          };
          this.onmessage?.({ data: response } as MessageEvent<OpticalFlowWorkerResponse>);
        } else if (request.type === "prefetch-compute") {
          const response: OpticalFlowWorkerResponse = {
            type: "prefetch-ready", requestId: request.requestId,
          };
          this.onmessage?.({ data: response } as MessageEvent<OpticalFlowWorkerResponse>);
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
      const previous = Uint16Array.from({ length: 12 }, (_, i) => i * 5000);
      const next = Uint16Array.from({ length: 12 }, (_, i) => 65535 - i * 5000);
      await client.prefetchFlow({ width: 2, height: 2, previousImageId: 0, nextImageId: 1,
        previousGamma2: previous, nextGamma2: next, winsize: 21,
        sessionId: "session-a", sessionCreatedAt: 1700000000000, alignmentKey: "align-1" });
      expect(seen.map((request) => request.type)).toEqual(miss
        ? ["prefetch-check", "prefetch-compute"] : ["prefetch-check"]);
      if (miss) {
        const compute = seen[1];
        if (compute.type !== "prefetch-compute") throw new Error("Missing Gray8 prefetch");
        expect(new Uint8Array(compute.previousGrayBuffer)).toHaveLength(4);
        expect(new Uint8Array(compute.nextGrayBuffer)).toHaveLength(4);
        expect(compute.prepareFlowInputsMs).toBeGreaterThanOrEqual(0);
      }
      // The subsequent sequential Warp still owns the unmodified RGB16 inputs.
      expect(previous.byteLength).toBe(24);
      expect(next.byteLength).toBe(24);
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

test("STF Flow-consumed notification refills prefetch before the first Warp stripe", async () => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events: string[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<OpticalFlowWorkerResponse>) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    postMessage(request: OpticalFlowWorkerRequest) {
      const send = (response: OpticalFlowWorkerResponse) => queueMicrotask(() =>
        this.onmessage?.({ data: response } as MessageEvent<OpticalFlowWorkerResponse>));
      if (request.type === "interpolate") {
        send({ type: "flow-consumed", requestId: request.requestId });
        // Guard against accidentally treating this event as the final result.
        send({ type: "flow-consumed", requestId: request.requestId });
        send({ type: "stripe", requestId: request.requestId, kind: "primary",
          y: 0, height: 2, width: 2, gamma2Buffer: new Uint16Array(12).buffer });
      } else if (request.type === "stripe-ack") {
        send({ type: "stream-result", requestId: request.requestId,
          width: 2, height: 2, performance: { flowWorkerCount: 2 } as never });
      }
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
      const pixels = new Uint16Array(12);
      await client.generateStripes({
        width: 2, height: 2, previousImageId: 0, nextImageId: 1,
        previousGamma2: pixels, nextGamma2: pixels, variant: "mid", winsize: 21,
        sessionId: "s", sessionCreatedAt: 1, alignmentKey: "k", inputOwnership: {},
      }, () => { events.push("stripe"); }, () => { events.push("consumed"); });
      expect(events).toEqual(["consumed", "stripe"]);
    } finally { client.terminate(); }
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
