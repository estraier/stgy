/// <reference lib="webworker" />

import { buildImageMixerLut } from "./mixer-lut";

type MixerLutWorkerRequest = {
  id: number;
  key: string;
  size: number;
  settings: Float32Array;
};

type MixerLutWorkerResponse = {
  id: number;
  key: string;
  size: number;
  data: Float32Array;
};

self.onmessage = (event: MessageEvent<MixerLutWorkerRequest>) => {
  const { id, key, size, settings } = event.data;
  const lut = buildImageMixerLut(settings, key, size);
  const response: MixerLutWorkerResponse = {
    id,
    key: lut.key,
    size: lut.size,
    data: lut.data,
  };
  self.postMessage(response, [response.data.buffer]);
};

export {};
