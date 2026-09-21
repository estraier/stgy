/// <reference lib="webworker" />

import { buildImageMixerLut } from "./mixer-lut";

type MixerLutWorkerRequest = {
  id: number;
  key: string;
  settings: Float32Array;
};

type MixerLutWorkerResponse = {
  id: number;
  key: string;
  size: number;
  data: Float32Array;
};

self.onmessage = (event: MessageEvent<MixerLutWorkerRequest>) => {
  const { id, key, settings } = event.data;
  const lut = buildImageMixerLut(settings, key);
  const response: MixerLutWorkerResponse = {
    id,
    key: lut.key,
    size: lut.size,
    data: lut.data,
  };
  self.postMessage(response, [response.data.buffer]);
};

export {};
