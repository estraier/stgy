import type { HdrWorkerRequest, HdrWorkerResponse } from "./protocols/hdr-protocol";

type MockWorkerScope = {
  onmessage: ((event: MessageEvent<HdrWorkerRequest>) => void) | null;
  postMessage: (response: HdrWorkerResponse, transfer?: Transferable[]) => void;
};

// One-pixel images have a single Mertens pyramid level. This mock exercises
// real HDR2 weight calculation and reconstruction, without loading OpenCV.js.
function makeOnePixelOpenCv() {
  class Mat {
    data32F: Float32Array;
    cols: number;
    rows: number;
    constructor(rows = 0, cols = 0, channels = 3) {
      this.rows = rows;
      this.cols = cols;
      this.data32F = new Float32Array(rows * cols * (channels === 1 ? 1 : 3));
    }
    delete() { /* Test-only OpenCV allocation. */ }
  }
  return {
    Mat: class extends Mat {
      constructor(rows = 0, cols = 0, type: number = 3) { super(rows, cols, type); }
    },
    CV_32FC3: 3,
    CV_32FC1: 1,
    Size: class { constructor(public width: number, public height: number) {} },
    pyrDown: () => { throw new Error("The 1x1 Mertens test should not downsample."); },
    pyrUp: () => { throw new Error("The 1x1 Mertens test should not upsample."); },
  };
}

async function createHdrWorker(): Promise<{
  send(request: HdrWorkerRequest, expectedType: HdrWorkerResponse["type"]): Promise<HdrWorkerResponse>;
  dispose(): void;
}> {
  jest.resetModules();
  jest.doMock("./opencv-runtime", () => ({
    loadWorkerOpenCv: async () => makeOnePixelOpenCv(),
  }));

  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
  let pending: {
    expectedType: HdrWorkerResponse["type"];
    resolve: (response: HdrWorkerResponse) => void;
    reject: (error: Error) => void;
  } | null = null;
  const worker: MockWorkerScope = {
    onmessage: null,
    postMessage(response) {
      const current = pending;
      if (!current) return;
      if (response.type === "error") {
        pending = null;
        current.reject(new Error(response.message));
      } else if (response.type === current.expectedType) {
        pending = null;
        current.resolve(response);
      }
    },
  };
  Object.defineProperty(globalThis, "self", { configurable: true, value: worker });
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./hdr.worker");
  });

  return {
    send(request, expectedType) {
      if (pending) throw new Error("The previous HDR message has not completed.");
      return new Promise((resolve, reject) => {
        pending = { expectedType, resolve, reject };
        if (!worker.onmessage) throw new Error("HDR Worker did not install an onmessage handler.");
        worker.onmessage({ data: request } as MessageEvent<HdrWorkerRequest>);
      });
    },
    dispose() {
      if (previousSelf) Object.defineProperty(globalThis, "self", previousSelf);
      else Reflect.deleteProperty(globalThis, "self");
      jest.dontMock("./opencv-runtime");
    },
  };
}

function assertLinearRgbResult(response: HdrWorkerResponse, field: "linearProPhotoBuffer" | "gamma2Buffer", pixelCount: number) {
  const bytes = field === "linearProPhotoBuffer" && response.type === "result"
    ? response.linearProPhotoBuffer
    : field === "gamma2Buffer" && response.type === "mertens-result"
      ? response.gamma2Buffer
      : null;
  if (!bytes) throw new Error(`HDR Worker did not produce ${field}.`);
  expect(Object.prototype.toString.call(bytes)).toBe("[object ArrayBuffer]");
  const result = new Float32Array(bytes);
  expect(result.length).toBe(pixelCount * 3);
  expect(Array.from(result).every(Number.isFinite)).toBe(true);
  expect(Array.from(result).every(value => value >= 0)).toBe(true);
}

describe("HDR Worker runtime regression tests", () => {
  test("HDR1 legacy Debevec merge returns finite RGB", async () => {
    const worker = await createHdrWorker();
    try {
      const response = await worker.send({
        type: "merge", requestId: 1, width: 1, height: 1,
        imageBuffers: [new Float32Array([0.2, 0.3, 0.4]).buffer, new Float32Array([0.4, 0.6, 0.8]).buffer],
        exposureTimesBuffer: new Float32Array([0.5, 1]).buffer,
        brightnessesBuffer: new Float32Array([0.3, 0.6]).buffer,
      }, "result");
      assertLinearRgbResult(response, "linearProPhotoBuffer", 1);
    } finally {
      worker.dispose();
    }
  });

  test("HDR1 streamed Debevec calibration computes all three RGB response curves", async () => {
    const worker = await createHdrWorker();
    try {
      const requestId = 2;
      const width = 2, height = 2;
      const frames = [0.2, 0.4, 0.7].map((exposure, i) => {
        const source = new Float32Array(width * height * 3);
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          const base = exposure * (0.6 + pixel * 0.1);
          source.set([base, Math.sqrt(base) * 0.7, base * base], pixel * 3);
        }
        return { source, brightness: 0.25 + i * 0.2 };
      });
      await worker.send({
        type: "merge-stream-init", requestId, width, height, imageCount: frames.length,
        exposureTimesBuffer: new Float32Array([0.25, 0.5, 1]).buffer,
        linearResponseFlagsBuffer: new Uint8Array([0, 0, 0]).buffer,
      }, "merge-stream-ready");
      for (let i = 0; i < frames.length; i += 1) {
        await worker.send({
          type: "merge-stream-image", requestId, imageIndex: i,
          brightness: frames[i].brightness, imageBuffer: frames[i].source.slice().buffer,
        }, "merge-stream-image-stored");
      }
      // The previous `channel is not defined` bug failed here.
      await worker.send({ type: "merge-stream-pass2-begin", requestId }, "merge-stream-pass2-ready");
      for (let i = 0; i < frames.length; i += 1) {
        await worker.send({
          type: "merge-stream-pass2-image", requestId, imageIndex: i,
          imageBuffer: frames[i].source.slice().buffer,
        }, "merge-stream-pass2-image-accepted");
      }
      const response = await worker.send({ type: "merge-stream-finalize", requestId }, "result");
      assertLinearRgbResult(response, "linearProPhotoBuffer", width * height);
    } finally {
      worker.dispose();
    }
  }, 30000);

  test.each([
    ["equal exposure times", [1, 1, 1]],
    ["missing exposure metadata", []],
    ["mismatched metadata with unchanged pixels", [0.25, 1, 4]],
  ])("HDR1 does not turn a contrast-bearing scene white for %s", async (_label, times) => {
    const worker = await createHdrWorker();
    try {
      const requestId = 20;
      const width = 8, height = 8, imageCount = 3;
      const source = new Float32Array(width * height * 3);
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        const value = 0.05 + pixel / (width * height - 1) * 0.65;
        source.set([value, value * 0.9, value * 0.8], pixel * 3);
      }
      await worker.send({
        type: "merge-stream-init", requestId, width, height, imageCount,
        exposureTimesBuffer: new Float32Array(times).buffer,
        linearResponseFlagsBuffer: new Uint8Array(imageCount).buffer,
      }, "merge-stream-ready");
      for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
        await worker.send({
          type: "merge-stream-image", requestId, imageIndex,
          brightness: 0.32, imageBuffer: source.slice().buffer,
        }, "merge-stream-image-stored");
      }
      await worker.send({ type: "merge-stream-pass2-begin", requestId }, "merge-stream-pass2-ready");
      for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
        await worker.send({
          type: "merge-stream-pass2-image", requestId, imageIndex,
          imageBuffer: source.slice().buffer,
        }, "merge-stream-pass2-image-accepted");
      }
      const response = await worker.send({ type: "merge-stream-finalize", requestId }, "result");
      assertLinearRgbResult(response, "linearProPhotoBuffer", width * height);
      if (response.type !== "result") throw new Error("HDR1 did not return a result.");
      const red = new Float32Array(response.linearProPhotoBuffer).filter((_value, index) => index % 3 === 0);
      expect(Math.min(...red)).toBeLessThan(0.3);
      expect(Math.max(...red) - Math.min(...red)).toBeGreaterThan(0.3);
    } finally {
      worker.dispose();
    }
  }, 30000);

  test("HDR2 streamed Mertens fusion returns finite RGB", async () => {
    const worker = await createHdrWorker();
    try {
      const requestId = 3;
      await worker.send({
        type: "mertens-stream-init", requestId, width: 1, height: 1,
        imageCount: 2, saturationWeight: 0.1, exposureWeight: 1,
      }, "mertens-stream-ready");
      for (let i = 0; i < 2; i += 1) {
        await worker.send({
          type: "mertens-stream-image", requestId, imageIndex: i,
          brightness: 0.3 + i * 0.3, imageBuffer: new Float32Array([0.2 + i * 0.2, 0.3 + i * 0.1, 0.4 + i * 0.2]).buffer,
        }, "mertens-stream-image-stored");
      }
      await worker.send({ type: "mertens-stream-pass2-begin", requestId }, "mertens-stream-pass2-ready");
      for (let i = 0; i < 2; i += 1) {
        await worker.send({
          type: "mertens-stream-pass2-image", requestId, imageIndex: i,
          imageBuffer: new Float32Array([0.2 + i * 0.2, 0.3 + i * 0.1, 0.4 + i * 0.2]).buffer,
        }, "mertens-stream-pass2-image-accepted");
      }
      const response = await worker.send({ type: "mertens-stream-finalize", requestId }, "mertens-result");
      assertLinearRgbResult(response, "gamma2Buffer", 1);
    } finally {
      worker.dispose();
    }
  });
});
