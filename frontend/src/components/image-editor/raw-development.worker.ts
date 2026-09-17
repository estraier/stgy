/// <reference lib="webworker" />

import {
  RAW_DEVELOPED_LINEAR_RANGE_MAX,
  analyzeRawDenoiseMask,
  applyRawColorPass,
  applyRawFallbackBaselinePass,
  applyRawMatchedTonePass,
  convertRawLinearToGamma20InPlace,
  developRawMasterOnePassToGamma20,
  developRawMasterOnePassRowsToGamma20,
  mergeRawDenoiseGamma20ChunkInPlace,
  mergeRawDenoiseGamma20InPlaceRows,
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

type DenoiseAnalyzeMessage = StartMessageBase & {
  type: "denoise-analyze";
  iso?: number | null;
};

type DenoiseMergeInitMessage = {
  type: "denoise-merge-init";
  weightBuffer: ArrayBuffer;
  weightWidth: number;
  weightHeight: number;
  imageWidth: number;
  imageHeight: number;
};

type DenoiseMergeChunkMessage = {
  type: "denoise-merge-chunk";
  masterBuffer: ArrayBuffer;
  denoiseBuffer: ArrayBuffer;
  rowStart: number;
};

type DenoiseMergeSharedMessage = {
  type: "denoise-merge-shared";
  masterBuffer: SharedArrayBuffer;
  denoiseBuffer: SharedArrayBuffer;
  weightBuffer: SharedArrayBuffer;
  width: number;
  height: number;
  weightWidth: number;
  weightHeight: number;
  rowStart: number;
  rowEnd: number;
  workerIndex: number;
};

type RawDevelopmentWorkerRequest =
  | ({ type: "matched-tone"; plan: RawMatchedTonePlan; sampleTargetPixels: number } & StartMessageBase)
  | ({ type: "fallback-tone" } & StartMessageBase)
  | DenoiseAnalyzeMessage
  | DenoiseMergeInitMessage
  | DenoiseMergeChunkMessage
  | DenoiseMergeSharedMessage
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
    } & StartMessageBase)
  | {
      type: "master-one-pass-shared";
      dataBuffer: SharedArrayBuffer;
      outputBuffer: SharedArrayBuffer;
      width: number;
      height: number;
      sourceLinearRangeMax: number;
      sourceTransfer?: RawStorageTransfer;
      correction?: RawLensfunCorrectionMaps;
      tonePlan?: RawMatchedTonePlan;
      fallbackPlan?: RawFallbackPlan;
      colorPlan?: RawColorPassPlan;
      rowStart: number;
      rowEnd: number;
      workerIndex: number;
    };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let state: WorkerState | null = null;
let denoiseMergeState: {
  weight: Float32Array;
  weightWidth: number;
  weightHeight: number;
  imageWidth: number;
  imageHeight: number;
} | null = null;

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

    if (message.type === "denoise-merge-init") {
      denoiseMergeState = {
        weight: new Float32Array(message.weightBuffer),
        weightWidth: message.weightWidth,
        weightHeight: message.weightHeight,
        imageWidth: message.imageWidth,
        imageHeight: message.imageHeight,
      };
      workerScope.postMessage({ type: "denoise-merge-ready" });
      return;
    }

    if (message.type === "denoise-merge-chunk") {
      if (!denoiseMergeState) throw new Error("RAW denoise merge worker is not initialized");
      const master = new Uint16Array(message.masterBuffer);
      const denoise = new Uint16Array(message.denoiseBuffer);
      mergeRawDenoiseGamma20ChunkInPlace(
        master,
        denoise,
        denoiseMergeState.imageWidth,
        denoiseMergeState.imageHeight,
        denoiseMergeState.weight,
        denoiseMergeState.weightWidth,
        denoiseMergeState.weightHeight,
        message.rowStart,
      );
      const denoiseBuffer = denoise.buffer as ArrayBuffer;
      workerScope.postMessage(
        {
          type: "denoise-merge-chunk-complete",
          denoiseBuffer,
          rowStart: message.rowStart,
          rowCount: denoise.length / (denoiseMergeState.imageWidth * 3),
        },
        [denoiseBuffer],
      );
      return;
    }

    if (message.type === "denoise-merge-shared") {
      const master = new Uint16Array(message.masterBuffer);
      const denoise = new Uint16Array(message.denoiseBuffer);
      const weight = new Float32Array(message.weightBuffer);
      mergeRawDenoiseGamma20InPlaceRows(
        master,
        denoise,
        message.width,
        message.height,
        weight,
        message.weightWidth,
        message.weightHeight,
        message.rowStart,
        message.rowEnd,
      );
      workerScope.postMessage({
        type: "denoise-merge-shared-complete",
        workerIndex: message.workerIndex,
        rowStart: message.rowStart,
        rowEnd: message.rowEnd,
      });
      return;
    }

    if (message.type === "denoise-analyze") {
      const data = new Uint16Array(message.dataBuffer);
      const analysis = analyzeRawDenoiseMask(
        data,
        message.width,
        message.height,
        message.sourceLinearRangeMax,
        message.sourceTransfer ?? "linear",
        message.iso,
      );
      const weightBuffer = analysis.weight.buffer as ArrayBuffer;
      workerScope.postMessage(
        {
          type: "denoise-analyze-complete",
          weightBuffer,
          width: analysis.width,
          height: analysis.height,
          smoothMean: analysis.smoothMean,
          smoothStddev: analysis.smoothStddev,
          shadowMean: analysis.shadowMean,
          shadowStddev: analysis.shadowStddev,
          weightMean: analysis.weightMean,
          weightStddev: analysis.weightStddev,
          weightP50: analysis.weightP50,
          weightP90: analysis.weightP90,
          weightP99: analysis.weightP99,
        },
        [weightBuffer],
      );
      return;
    }

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
          linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
          transfer: "gamma20",
        },
        [outputBuffer],
      );
      return;
    }

    if (message.type === "master-one-pass-shared") {
      const sourceData = new Uint16Array(message.dataBuffer);
      const outputData = new Uint16Array(message.outputBuffer);
      const result = developRawMasterOnePassRowsToGamma20(
        sourceData,
        message.width,
        message.height,
        message.sourceLinearRangeMax,
        message.sourceTransfer ?? "linear",
        message.correction,
        message.tonePlan,
        message.fallbackPlan,
        message.colorPlan,
        outputData,
        message.rowStart,
        message.rowEnd,
      );
      workerScope.postMessage({
        type: "master-one-pass-shared-complete",
        workerIndex: message.workerIndex,
        rowStart: message.rowStart,
        rowEnd: message.rowEnd,
        width: result.width,
        height: result.height,
        linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
        transfer: "gamma20",
        headroom: result.headroom,
      });
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
          width: result.width,
          height: result.height,
          linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
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
      state.linearRangeMax = RAW_DEVELOPED_LINEAR_RANGE_MAX;
      state.transfer = "gamma20";
      const colorSample = sampleRawLinearRgb(
        data,
        message.width,
        message.height,
        state.linearRangeMax,
        message.sampleTargetPixels,
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
        state.linearRangeMax = RAW_DEVELOPED_LINEAR_RANGE_MAX;
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
