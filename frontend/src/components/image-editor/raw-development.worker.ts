/// <reference lib="webworker" />

import {
  applyRawColorPass,
  applyRawFallbackBaselinePass,
  applyRawMatchedTonePass,
  convertRawLinearToGamma20InPlace,
  sampleRawLinearRgb,
  type RawColorPassPlan,
  type RawMatchedTonePlan,
  type RawVignettingMap,
} from "./raw-development-core";

type WorkerState = {
  data: Uint16Array;
  width: number;
  height: number;
  linearRangeMax: number;
};

type StartMessageBase = {
  dataBuffer: ArrayBuffer;
  width: number;
  height: number;
  sourceLinearRangeMax: number;
  vignetting?: RawVignettingMap;
};

type RawDevelopmentWorkerRequest =
  | ({ type: "matched-tone"; plan: RawMatchedTonePlan; sampleMaxSide: number } & StartMessageBase)
  | ({ type: "fallback-tone" } & StartMessageBase)
  | { type: "color"; plan: RawColorPassPlan }
  | { type: "encode" };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let state: WorkerState | null = null;

function postError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (state && state.data.buffer.byteLength > 0) {
    const buffer = state.data.buffer as ArrayBuffer;
    const linearRangeMax = state.linearRangeMax;
    workerScope.postMessage(
      { type: "error", message, dataBuffer: buffer, linearRangeMax },
      [buffer],
    );
    state = null;
    return;
  }
  workerScope.postMessage({ type: "error", message });
}

workerScope.onmessage = (event: MessageEvent<RawDevelopmentWorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === "matched-tone") {
      const data = new Uint16Array(message.dataBuffer);
      state = {
        data,
        width: message.width,
        height: message.height,
        linearRangeMax: message.sourceLinearRangeMax,
      };
      const headroom = applyRawMatchedTonePass(
        data,
        message.width,
        message.height,
        message.sourceLinearRangeMax,
        message.vignetting,
        message.plan,
      );
      state.linearRangeMax = 2;
      const colorSample = sampleRawLinearRgb(
        data,
        message.width,
        message.height,
        state.linearRangeMax,
        message.sampleMaxSide,
      );
      workerScope.postMessage(
        { type: "tone-complete", headroom, colorSample: colorSample.buffer },
        [colorSample.buffer],
      );
      return;
    }

    if (message.type === "fallback-tone") {
      const data = new Uint16Array(message.dataBuffer);
      state = {
        data,
        width: message.width,
        height: message.height,
        linearRangeMax: message.sourceLinearRangeMax,
      };
      const result = applyRawFallbackBaselinePass(
        data,
        message.width,
        message.height,
        message.sourceLinearRangeMax,
        message.vignetting,
      );
      if (result) state.linearRangeMax = 2;
      workerScope.postMessage({ type: "fallback-tone-complete", result });
      return;
    }

    if (!state) throw new Error("RAW development worker has no active image");

    if (message.type === "color") {
      applyRawColorPass(state.data, state.linearRangeMax, message.plan);
      workerScope.postMessage({ type: "color-complete" });
      return;
    }

    if (message.type === "encode") {
      convertRawLinearToGamma20InPlace(state.data, state.linearRangeMax);
      const buffer = state.data.buffer as ArrayBuffer;
      const linearRangeMax = state.linearRangeMax;
      workerScope.postMessage(
        { type: "encode-complete", dataBuffer: buffer, linearRangeMax },
        [buffer],
      );
      state = null;
    }
  } catch (error) {
    postError(error);
  }
};
