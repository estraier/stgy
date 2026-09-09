/// <reference lib="webworker" />

import {
  applyRawColorPass,
  applyRawFallbackBaselinePass,
  applyRawMatchedTonePass,
  convertRawLinearToGamma20InPlace,
  developRawMasterOnePassToGamma20,
  resampleRawWithLensfunToGamma20,
  sampleRawLinearRgb,
  type RawColorPassPlan,
  type RawFallbackPlan,
  type RawLensfunCorrectionMaps,
  type RawMatchedTonePlan,
  type RawStorageTransfer,
  type RawVignettingMap,
} from "./raw-development-core";

type WorkerState = {
  data: Uint16Array;
  width: number;
  height: number;
  linearRangeMax: number;
  transfer: RawStorageTransfer;
};

type StartMessageBase = {
  dataBuffer: ArrayBuffer;
  width: number;
  height: number;
  sourceLinearRangeMax: number;
  sourceTransfer?: RawStorageTransfer;
  vignetting?: RawVignettingMap;
};

type RawDevelopmentWorkerRequest =
  | ({ type: "matched-tone"; plan: RawMatchedTonePlan; sampleMaxSide: number } & StartMessageBase)
  | ({ type: "fallback-tone" } & StartMessageBase)
  | { type: "color"; plan: RawColorPassPlan }
  | { type: "encode" }
  | ({
      type: "lensfun-resample";
      correction?: RawLensfunCorrectionMaps;
      targetWidth: number;
      targetHeight: number;
    } & StartMessageBase)
  | ({
      type: "master-one-pass";
      correction?: RawLensfunCorrectionMaps;
      tonePlan?: RawMatchedTonePlan;
      fallbackPlan?: RawFallbackPlan;
      colorPlan?: RawColorPassPlan;
    } & StartMessageBase);

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let state: WorkerState | null = null;

function postError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (state && state.data.buffer.byteLength > 0) {
    const buffer = state.data.buffer as ArrayBuffer;
    const linearRangeMax = state.linearRangeMax;
    const transfer = state.transfer;
    workerScope.postMessage(
      { type: "error", message, dataBuffer: buffer, linearRangeMax, transfer },
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

    if (message.type === "lensfun-resample") {
      const data = new Uint16Array(message.dataBuffer);
      state = {
        data,
        width: message.width,
        height: message.height,
        linearRangeMax: message.sourceLinearRangeMax,
        transfer: message.sourceTransfer ?? "linear",
      };
      const output = resampleRawWithLensfunToGamma20(
        data,
        message.width,
        message.height,
        message.sourceLinearRangeMax,
        state.transfer,
        message.correction,
        message.targetWidth,
        message.targetHeight,
      );
      state = null;
      const outputBuffer = output.buffer as ArrayBuffer;
      workerScope.postMessage(
        {
          type: "lensfun-resample-complete",
          dataBuffer: outputBuffer,
          width: Math.max(1, Math.round(message.targetWidth)),
          height: Math.max(1, Math.round(message.targetHeight)),
          linearRangeMax: 2,
          transfer: "gamma20",
        },
        [outputBuffer],
      );
      return;
    }

    if (message.type === "master-one-pass") {
      const sourceData = new Uint16Array(message.dataBuffer);
      state = {
        data: sourceData,
        width: message.width,
        height: message.height,
        linearRangeMax: message.sourceLinearRangeMax,
        transfer: message.sourceTransfer ?? "linear",
      };
      const result = developRawMasterOnePassToGamma20(
        sourceData,
        message.width,
        message.height,
        message.sourceLinearRangeMax,
        state.transfer,
        message.correction,
        message.tonePlan,
        message.fallbackPlan,
        message.colorPlan,
      );
      state = null;
      const outputBuffer = result.data.buffer as ArrayBuffer;
      workerScope.postMessage(
        {
          type: "master-one-pass-complete",
          dataBuffer: outputBuffer,
          width: message.width,
          height: message.height,
          linearRangeMax: 2,
          transfer: "gamma20",
          headroom: result.headroom,
        },
        [outputBuffer],
      );
      return;
    }

    if (message.type === "matched-tone") {
      const data = new Uint16Array(message.dataBuffer);
      state = {
        data,
        width: message.width,
        height: message.height,
        linearRangeMax: message.sourceLinearRangeMax,
        transfer: message.sourceTransfer ?? "linear",
      };
      const headroom = applyRawMatchedTonePass(
        data,
        message.width,
        message.height,
        message.sourceLinearRangeMax,
        message.vignetting,
        message.plan,
        state.transfer,
      );
      state.linearRangeMax = 2;
      state.transfer = "gamma20";
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
        transfer: message.sourceTransfer ?? "linear",
      };
      const result = applyRawFallbackBaselinePass(
        data,
        message.width,
        message.height,
        message.sourceLinearRangeMax,
        message.vignetting,
        state.transfer,
      );
      if (result) {
        state.linearRangeMax = 2;
        state.transfer = "gamma20";
      }
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
      if (state.transfer === "linear") {
        convertRawLinearToGamma20InPlace(state.data, state.linearRangeMax);
        state.transfer = "gamma20";
      }
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
