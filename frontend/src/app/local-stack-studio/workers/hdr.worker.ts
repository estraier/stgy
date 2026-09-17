// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Local Stack Studio worker source. Built to public/generated/local-stack-studio.
import { loadWorkerOpenCv } from "./opencv-runtime";
const HDR_FLOAT_MIN_RESPONSE = 1e-12;
const HDR_FLOAT_WEIGHT_EPSILON = 1e-12;
const REINHARD_GAMMA = 1.0;
const REINHARD_INTENSITY = 0.0;
const REINHARD_LIGHT_ADAPT = 0.5;
const REINHARD_COLOR_ADAPT = 0.5;
const BRIGHTNESS_MAX_TRIES = 10;
const BRIGHTNESS_MAX_DIST = 0.01;

let debevecStreamState = null;
let mertensStreamState = null;
let workerMessageQueue = Promise.resolve();

self.onmessage = (event) => {
  const message = event.data || {};
  workerMessageQueue = workerMessageQueue
    .then(() => dispatchWorkerMessage(message))
    .catch(async (error) => {
      if (mertensStreamState) {
        try {
          await cleanupMertensStreamState();
        } catch {
          // Best-effort scratch cleanup; report the original processing error.
        }
      }
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
};

async function dispatchWorkerMessage(message) {
  if (message.type === "merge") {
    processDebevecMessage(message);
    return;
  }
  if (message.type === "merge-stream-init") {
    initializeDebevecStream(message);
    return;
  }
  if (message.type === "merge-stream-image") {
    appendDebevecStreamImage(message);
    return;
  }
  if (message.type === "merge-stream-finalize") {
    finalizeDebevecStream();
    return;
  }
  if (message.type === "mertens") {
    await processMertensMessage(message);
    return;
  }
  if (message.type === "mertens-stream-init") {
    await initializeMertensStream(message);
    return;
  }
  if (message.type === "mertens-stream-image") {
    await appendMertensStreamImage(message);
    return;
  }
  if (message.type === "mertens-stream-finalize") {
    await finalizeMertensStream(message);
    return;
  }
  if (message.type === "mertens-stream-abort") {
    const requestId = message.requestId;
    await cleanupMertensStreamState();
    self.postMessage({ type: "mertens-stream-aborted", requestId });
  }
}

function processDebevecMessage(message) {
  const width = Number(message.width);
  const height = Number(message.height);
  const imageBuffers = Array.isArray(message.imageBuffers) ? message.imageBuffers : [];
  const suppliedExposureTimes = new Float32Array(message.exposureTimesBuffer);
  const brightnesses = new Float32Array(message.brightnessesBuffer);

  validateInputs(width, height, imageBuffers, suppliedExposureTimes, brightnesses);
  const images = imageBuffers.map((buffer) => new Float32Array(buffer));
  const exposureTimes = resolveExposureTimes(suppliedExposureTimes, brightnesses);
  const targetBrightness = meanArray(brightnesses);
  const preBrightnessSigmoidGain = Number.isFinite(message.preBrightnessSigmoidGain)
    ? Number(message.preBrightnessSigmoidGain)
    : 0;

  postProgress("Merging HDR with Debevec...");
  const hdr = mergeDebevecWithLinearResponse(images, exposureTimes, width, height);
  images.length = 0;
  imageBuffers.length = 0;

  postProgress("Tone mapping HDR with Reinhard...");
  tonemapReinhardInPlace(
    hdr,
    REINHARD_GAMMA,
    REINHARD_INTENSITY,
    REINHARD_LIGHT_ADAPT,
    REINHARD_COLOR_ADAPT,
  );

  if (Math.abs(preBrightnessSigmoidGain) > 1e-6) {
    postProgress("Applying single-shot HDR1 sigmoid...");
    applySigmoidInPlace(hdr, preBrightnessSigmoidGain, 0.5);
  }

  postProgress("Restoring HDR brightness...");
  adjustExposureToBrightnessInPlace(hdr, targetBrightness);

  self.postMessage(
    { type: "result", linearProPhotoBuffer: hdr.buffer },
    [hdr.buffer],
  );
}


function initializeDebevecStream(message) {
  const width = Number(message.width);
  const height = Number(message.height);
  const imageCount = Number(message.imageCount);
  const suppliedExposureTimes = new Float32Array(message.exposureTimesBuffer || new ArrayBuffer(0));
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new Error("HDR worker received invalid image dimensions.");
  }
  if (!(Number.isInteger(imageCount) && imageCount >= 2)) {
    throw new Error("HDR1 streaming requires at least two input images.");
  }
  if (suppliedExposureTimes.length !== 0 && suppliedExposureTimes.length !== imageCount) {
    throw new Error("HDR exposure-time count does not match the image count.");
  }
  for (let i = 0; i < suppliedExposureTimes.length; i += 1) {
    if (!(Number.isFinite(suppliedExposureTimes[i]) && suppliedExposureTimes[i] > 0)) {
      throw new Error(`HDR input ${i + 1} has an invalid exposure value.`);
    }
  }
  const pixelCount = width * height;
  debevecStreamState = {
    width,
    height,
    imageCount,
    receivedCount: 0,
    responseSums: new Float32Array(pixelCount * 3),
    weightSums: new Float32Array(pixelCount),
    weightedLogBrightnessSums: suppliedExposureTimes.length === 0 ? new Float32Array(pixelCount) : null,
    brightnesses: new Float32Array(imageCount),
    receivedFlags: new Uint8Array(imageCount),
    suppliedExposureTimes,
    preBrightnessSigmoidGain: Number.isFinite(message.preBrightnessSigmoidGain)
      ? Number(message.preBrightnessSigmoidGain)
      : 0,
  };
  debevecStreamState.brightnesses.fill(Number.NaN);
}

function appendDebevecStreamImage(message) {
  if (!debevecStreamState) {
    throw new Error("HDR1 stream worker was not initialized.");
  }
  const imageIndex = Number(message.imageIndex);
  const brightness = Number(message.brightness);
  if (!(Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < debevecStreamState.imageCount)) {
    throw new Error("HDR1 stream worker received an invalid image index.");
  }
  if (debevecStreamState.receivedFlags[imageIndex]) {
    throw new Error(`HDR input ${imageIndex + 1} was sent more than once.`);
  }
  if (!(Number.isFinite(brightness) && brightness >= 0)) {
    throw new Error(`HDR input ${imageIndex + 1} has an invalid brightness value.`);
  }
  const imageBuffer = message.imageBuffer;
  const expectedLength = debevecStreamState.width * debevecStreamState.height * 3;
  const expectedByteLength = expectedLength * Float32Array.BYTES_PER_ELEMENT;
  if (!(imageBuffer instanceof ArrayBuffer) || imageBuffer.byteLength !== expectedByteLength) {
    throw new Error(`HDR input ${imageIndex + 1} has an invalid Float32 RGB buffer.`);
  }
  const image = new Float32Array(imageBuffer);
  const responseSums = debevecStreamState.responseSums;
  const weightSums = debevecStreamState.weightSums;
  const weightedLogBrightnessSums = debevecStreamState.weightedLogBrightnessSums;
  const suppliedExposureTimes = debevecStreamState.suppliedExposureTimes;
  const hasExposureTimes = suppliedExposureTimes.length > 0;
  const logExposureTime = hasExposureTimes ? Math.log(suppliedExposureTimes[imageIndex]) : 0;
  const logBrightness = hasExposureTimes ? 0 : Math.log(Math.max(brightness, 0.0001));
  const pixelCount = debevecStreamState.width * debevecStreamState.height;

  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
    const r = clamp01(image[offset]);
    const g = clamp01(image[offset + 1]);
    const b = clamp01(image[offset + 2]);
    const weight = (debevecWeightFloat(r) + debevecWeightFloat(g) + debevecWeightFloat(b)) / 3;
    responseSums[offset] += hasExposureTimes
      ? weight * (debevecLogResponseFloat(r) - logExposureTime)
      : weight * debevecLogResponseFloat(r);
    responseSums[offset + 1] += hasExposureTimes
      ? weight * (debevecLogResponseFloat(g) - logExposureTime)
      : weight * debevecLogResponseFloat(g);
    responseSums[offset + 2] += hasExposureTimes
      ? weight * (debevecLogResponseFloat(b) - logExposureTime)
      : weight * debevecLogResponseFloat(b);
    weightSums[pixel] += weight;
    if (weightedLogBrightnessSums) {
      weightedLogBrightnessSums[pixel] += weight * logBrightness;
    }
  }

  debevecStreamState.receivedFlags[imageIndex] = 1;
  debevecStreamState.brightnesses[imageIndex] = brightness;
  debevecStreamState.receivedCount += 1;
}

function finalizeDebevecStream() {
  if (!debevecStreamState) {
    throw new Error("HDR1 stream worker was not initialized.");
  }
  if (debevecStreamState.receivedCount !== debevecStreamState.imageCount) {
    throw new Error(
      `HDR1 stream worker received ${debevecStreamState.receivedCount}/${debevecStreamState.imageCount} input images.`
    );
  }
  const brightnesses = debevecStreamState.brightnesses;
  for (let i = 0; i < brightnesses.length; i += 1) {
    if (!(Number.isFinite(brightnesses[i]) && brightnesses[i] >= 0)) {
      throw new Error(`HDR input ${i + 1} has an invalid brightness value.`);
    }
  }

  postProgress("Finalizing streamed HDR with Debevec...");
  const hdr = finalizeDebevecStreamToHdr(debevecStreamState);
  const targetBrightness = meanArray(brightnesses);
  const preBrightnessSigmoidGain = debevecStreamState.preBrightnessSigmoidGain;
  debevecStreamState = null;

  postProgress("Tone mapping HDR with Reinhard...");
  tonemapReinhardInPlace(
    hdr,
    REINHARD_GAMMA,
    REINHARD_INTENSITY,
    REINHARD_LIGHT_ADAPT,
    REINHARD_COLOR_ADAPT,
  );

  if (Math.abs(preBrightnessSigmoidGain) > 1e-6) {
    postProgress("Applying single-shot HDR1 sigmoid...");
    applySigmoidInPlace(hdr, preBrightnessSigmoidGain, 0.5);
  }

  postProgress("Restoring HDR brightness...");
  adjustExposureToBrightnessInPlace(hdr, targetBrightness);

  self.postMessage(
    { type: "result", linearProPhotoBuffer: hdr.buffer },
    [hdr.buffer],
  );
}

function finalizeDebevecStreamToHdr(state) {
  const pixelCount = state.width * state.height;
  const result = new Float32Array(pixelCount * 3);
  const responseSums = state.responseSums;
  const weightSums = state.weightSums;
  const weightedLogBrightnessSums = state.weightedLogBrightnessSums;
  let minBrightness = Infinity;
  if (weightedLogBrightnessSums) {
    for (let i = 0; i < state.brightnesses.length; i += 1) {
      if (state.brightnesses[i] < minBrightness) minBrightness = state.brightnesses[i];
    }
    minBrightness = Math.max(minBrightness, 0.0001);
  }
  const minLogBrightness = weightedLogBrightnessSums ? Math.log(minBrightness) : 0;

  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
    const weightSum = weightSums[pixel];
    const inverseWeight = weightSum > 0 ? 1 / weightSum : 0;
    const weightedLogTime = weightedLogBrightnessSums
      ? (weightedLogBrightnessSums[pixel] - minLogBrightness * weightSum)
      : 0;
    result[offset] = sanitizeHdrValue(Math.exp((responseSums[offset] - weightedLogTime) * inverseWeight));
    result[offset + 1] = sanitizeHdrValue(Math.exp((responseSums[offset + 1] - weightedLogTime) * inverseWeight));
    result[offset + 2] = sanitizeHdrValue(Math.exp((responseSums[offset + 2] - weightedLogTime) * inverseWeight));
  }

  return result;
}

async function processMertensMessage(message) {
  const width = Number(message.width);
  const height = Number(message.height);
  const imageBuffers = Array.isArray(message.imageBuffers) ? message.imageBuffers : [];
  const brightnesses = new Float32Array(message.brightnessesBuffer || new ArrayBuffer(0));
  validateMertensInputs(width, height, imageBuffers, brightnesses);
  const images = imageBuffers.map((buffer) => new Float32Array(buffer));
  const saturationWeight = Number.isFinite(message.saturationWeight) ? Number(message.saturationWeight) : 0.1;
  const exposureWeight = Number.isFinite(message.exposureWeight) ? Number(message.exposureWeight) : 1;
  const targetBrightness = meanArray(brightnesses);
  postProgress("Loading OpenCV for HDR2 Mertens exposure fusion...");
  const cv = await loadWorkerOpenCv("HDR2");
  if (typeof cv.pyrDown !== "function" || typeof cv.pyrUp !== "function") {
    throw new Error("OpenCV.js does not provide pyrDown()/pyrUp() required for HDR2 Mertens fusion.");
  }

  postProgress("Merging HDR2 with OpenCV Gaussian/Laplacian Mertens fusion...");
  const merged = mergeMertensWithOpenCvPyramids(
    cv,
    images,
    width,
    height,
    saturationWeight,
    exposureWeight,
  );

  postProgress("Restoring HDR2 brightness...");
  adjustExposureToBrightnessInPlace(merged, targetBrightness);

  // `gamma2Buffer` is retained as the transport field name for compatibility.
  // The buffer contents are linear ProPhoto RGB; no gamma-2 transform is applied here.
  self.postMessage(
    { type: "mertens-result", gamma2Buffer: merged.buffer },
    [merged.buffer],
  );
}

const HDR2_SCRATCH_DB_NAME = "local-stack-studio-hdr2-scratch";
const HDR2_SCRATCH_DB_VERSION = 1;
const HDR2_SCRATCH_STORE = "images";

function createHdr2ScratchSessionId() {
  if (self.crypto && typeof self.crypto.randomUUID === "function") return self.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openHdr2ScratchDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) {
      reject(new Error("HDR2 streaming requires IndexedDB support in this browser."));
      return;
    }
    const request = indexedDB.open(HDR2_SCRATCH_DB_NAME, HDR2_SCRATCH_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HDR2_SCRATCH_STORE)) db.createObjectStore(HDR2_SCRATCH_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open HDR2 scratch storage."));
    request.onblocked = () => reject(new Error("HDR2 scratch storage is blocked by another Local Stack Studio tab."));
  });
}

function hdr2ScratchKey(sessionId, imageIndex) {
  return `${sessionId}:${imageIndex}`;
}

function putHdr2ScratchImage(db, key, buffer) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(HDR2_SCRATCH_STORE, "readwrite");
      transaction.objectStore(HDR2_SCRATCH_STORE).put(buffer, key);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not write HDR2 scratch image."));
    transaction.onabort = () => reject(transaction.error || new Error("HDR2 scratch image write was aborted."));
  });
}

function getHdr2ScratchImage(db, key) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(HDR2_SCRATCH_STORE, "readonly");
    } catch (error) {
      reject(error);
      return;
    }
    const request = transaction.objectStore(HDR2_SCRATCH_STORE).get(key);
    request.onsuccess = () => {
      if (!(request.result instanceof ArrayBuffer)) {
        reject(new Error("HDR2 scratch image is missing or invalid."));
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("Could not read HDR2 scratch image."));
  });
}

function deleteHdr2ScratchImage(db, key) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(HDR2_SCRATCH_STORE, "readwrite");
      transaction.objectStore(HDR2_SCRATCH_STORE).delete(key);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not delete HDR2 scratch image."));
    transaction.onabort = () => reject(transaction.error || new Error("HDR2 scratch image deletion was aborted."));
  });
}

function deleteHdr2ScratchSession(db, sessionId) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(HDR2_SCRATCH_STORE, "readwrite");
    } catch (error) {
      reject(error);
      return;
    }
    const store = transaction.objectStore(HDR2_SCRATCH_STORE);
    const prefix = `${sessionId}:`;
    const request = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error("Could not enumerate HDR2 scratch images."));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not clear HDR2 scratch images."));
    transaction.onabort = () => reject(transaction.error || new Error("HDR2 scratch cleanup was aborted."));
  });
}

async function initializeMertensStream(message) {
  if (mertensStreamState) throw new Error("HDR2 stream worker is already initialized.");
  const width = Number(message.width);
  const height = Number(message.height);
  const imageCount = Number(message.imageCount);
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error("HDR2 worker received invalid image dimensions.");
  }
  if (!(Number.isInteger(imageCount) && imageCount >= 2)) {
    throw new Error("HDR2 streaming requires at least two input images.");
  }
  let db = null;
  try {
    db = await openHdr2ScratchDb();
  } catch (error) {
    console.warn("HDR2 IndexedDB scratch is unavailable; using in-memory streaming fallback:", error);
  }
  mertensStreamState = {
    width,
    height,
    imageCount,
    receivedCount: 0,
    brightnesses: new Float32Array(imageCount),
    receivedFlags: new Uint8Array(imageCount),
    saturationWeight: Number.isFinite(message.saturationWeight) ? Number(message.saturationWeight) : 0.1,
    exposureWeight: Number.isFinite(message.exposureWeight) ? Number(message.exposureWeight) : 1,
    db,
    sessionId: createHdr2ScratchSessionId(),
    memoryImages: new Map(),
    scratchWriteDisabled: !db,
  };
  mertensStreamState.brightnesses.fill(Number.NaN);
  self.postMessage({ type: "mertens-stream-ready", requestId: message.requestId });
}

async function appendMertensStreamImage(message) {
  const state = mertensStreamState;
  if (!state) throw new Error("HDR2 stream worker was not initialized.");
  const imageIndex = Number(message.imageIndex);
  const brightness = Number(message.brightness);
  if (!(Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < state.imageCount)) {
    throw new Error("HDR2 stream worker received an invalid image index.");
  }
  if (state.receivedFlags[imageIndex]) throw new Error(`HDR2 input ${imageIndex + 1} was sent more than once.`);
  if (!(Number.isFinite(brightness) && brightness >= 0)) {
    throw new Error(`HDR2 input ${imageIndex + 1} has an invalid brightness value.`);
  }
  const imageBuffer = message.imageBuffer;
  const expectedByteLength = state.width * state.height * 3 * Float32Array.BYTES_PER_ELEMENT;
  if (!(imageBuffer instanceof ArrayBuffer) || imageBuffer.byteLength !== expectedByteLength) {
    throw new Error(`HDR2 input ${imageIndex + 1} has an invalid Float32 RGB buffer.`);
  }
  if (!state.scratchWriteDisabled && state.db) {
    postProgress(`Storing HDR2 input ${imageIndex + 1}/${state.imageCount} in scratch space...`);
    try {
      await putHdr2ScratchImage(state.db, hdr2ScratchKey(state.sessionId, imageIndex), imageBuffer);
    } catch (error) {
      state.scratchWriteDisabled = true;
      state.memoryImages.set(imageIndex, imageBuffer);
      console.warn("HDR2 scratch write failed; keeping remaining inputs in worker memory:", error);
    }
  } else {
    state.memoryImages.set(imageIndex, imageBuffer);
  }
  state.receivedFlags[imageIndex] = 1;
  state.brightnesses[imageIndex] = brightness;
  state.receivedCount += 1;
  self.postMessage({
    type: "mertens-stream-image-stored",
    requestId: message.requestId,
    imageIndex,
  });
}

async function getMertensStreamImageBuffer(state, imageIndex) {
  const memoryBuffer = state.memoryImages.get(imageIndex);
  if (memoryBuffer instanceof ArrayBuffer) return memoryBuffer;
  if (!state.db) throw new Error(`HDR2 input ${imageIndex + 1} is unavailable.`);
  return await getHdr2ScratchImage(state.db, hdr2ScratchKey(state.sessionId, imageIndex));
}

async function releaseMertensStreamImage(state, imageIndex) {
  if (state.memoryImages.delete(imageIndex)) return;
  if (!state.db) return;
  try {
    await deleteHdr2ScratchImage(state.db, hdr2ScratchKey(state.sessionId, imageIndex));
  } catch (error) {
    console.warn(`Could not delete HDR2 scratch input ${imageIndex + 1}:`, error);
  }
}

async function finalizeMertensStream(message) {
  const state = mertensStreamState;
  if (!state) throw new Error("HDR2 stream worker was not initialized.");
  if (state.receivedCount !== state.imageCount) {
    throw new Error(`HDR2 stream worker received ${state.receivedCount}/${state.imageCount} input images.`);
  }
  for (let i = 0; i < state.brightnesses.length; i += 1) {
    if (!(Number.isFinite(state.brightnesses[i]) && state.brightnesses[i] >= 0)) {
      throw new Error(`HDR2 input ${i + 1} has an invalid brightness value.`);
    }
  }

  postProgress("Loading OpenCV for HDR2 Mertens exposure fusion...");
  const cv = await loadWorkerOpenCv("HDR2");
  if (typeof cv.pyrDown !== "function" || typeof cv.pyrUp !== "function") {
    throw new Error("OpenCV.js does not provide pyrDown()/pyrUp() required for HDR2 Mertens fusion.");
  }
  const dimensions = buildOpenCvMertensPyramidDimensions(state.width, state.height);
  const fusedLevels = createMertensFusedLevels(dimensions);
  const expectedByteLength = state.width * state.height * 3 * Float32Array.BYTES_PER_ELEMENT;
  const weightSums = new Float32Array(state.width * state.height);

  // Mertens normalization is a two-pass algorithm. Read scratch inputs in
  // image-index order for both passes so Float32 accumulation order matches
  // the former all-in-memory implementation even when alignment recovery
  // delivered some images out of order.
  for (let imageIndex = 0; imageIndex < state.imageCount; imageIndex += 1) {
    postProgress(`Analyzing HDR2 weights ${imageIndex + 1}/${state.imageCount}...`);
    const buffer = await getMertensStreamImageBuffer(state, imageIndex);
    if (buffer.byteLength !== expectedByteLength) {
      throw new Error(`HDR2 scratch input ${imageIndex + 1} has an invalid size.`);
    }
    accumulateOpenCvMertensWeightSums(
      new Float32Array(buffer),
      state.width,
      state.height,
      state.saturationWeight,
      state.exposureWeight,
      weightSums,
    );
  }

  for (let imageIndex = 0; imageIndex < state.imageCount; imageIndex += 1) {
    postProgress(`Merging HDR2 input ${imageIndex + 1}/${state.imageCount}...`);
    const buffer = await getMertensStreamImageBuffer(state, imageIndex);
    if (buffer.byteLength !== expectedByteLength) {
      throw new Error(`HDR2 scratch input ${imageIndex + 1} has an invalid size.`);
    }
    accumulateMertensImagePyramid(
      cv,
      new Float32Array(buffer),
      state.imageCount,
      state.width,
      state.height,
      state.saturationWeight,
      state.exposureWeight,
      weightSums,
      dimensions,
      fusedLevels,
    );
    await releaseMertensStreamImage(state, imageIndex);
  }

  const merged = reconstructMertensFusedLevels(cv, fusedLevels, dimensions, state.width, state.height);
  postProgress("Restoring HDR2 brightness...");
  adjustExposureToBrightnessInPlace(merged, meanArray(state.brightnesses));
  try {
    await cleanupMertensStreamState();
  } catch (error) {
    console.warn("Could not fully clear HDR2 scratch images:", error);
  }
  self.postMessage(
    { type: "mertens-result", requestId: message.requestId, gamma2Buffer: merged.buffer },
    [merged.buffer],
  );
}

async function cleanupMertensStreamState() {
  const state = mertensStreamState;
  mertensStreamState = null;
  if (!state) return;
  state.memoryImages.clear();
  if (!state.db) return;
  try {
    await deleteHdr2ScratchSession(state.db, state.sessionId);
  } finally {
    state.db.close();
  }
}

const MERTENS_PROCESSING_GAMMA = 2.4;
const MERTENS_WEIGHT_EPSILON = 1e-12;

function mergeMertensWithOpenCvPyramids(cv, images, width, height, saturationWeight, exposureWeight) {
  const pixelCount = width * height;
  const weightSums = new Float32Array(pixelCount);

  // Build full-resolution Mertens weights in the gamma-2.4
  // processing domain. contrastWeight is fixed to zero for LSS HDR2.
  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    accumulateOpenCvMertensWeightSums(
      images[imageIndex],
      width,
      height,
      saturationWeight,
      exposureWeight,
      weightSums,
    );
  }

  const dimensions = buildOpenCvMertensPyramidDimensions(width, height);
  const fusedLevels = createMertensFusedLevels(dimensions);
  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    accumulateMertensImagePyramid(
      cv,
      images[imageIndex],
      images.length,
      width,
      height,
      saturationWeight,
      exposureWeight,
      weightSums,
      dimensions,
      fusedLevels,
    );
    images[imageIndex] = null;
  }
  return reconstructMertensFusedLevels(cv, fusedLevels, dimensions, width, height);
}

function createMertensFusedLevels(dimensions) {
  return dimensions.map(({ width: levelWidth, height: levelHeight }) =>
    new Float32Array(levelWidth * levelHeight * 3));
}

function accumulateMertensImagePyramid(
  cv,
  source,
  imageCount,
  width,
  height,
  saturationWeight,
  exposureWeight,
  weightSums,
  dimensions,
  fusedLevels,
) {
  const pixelCount = width * height;
  let currentRgb = new cv.Mat(height, width, cv.CV_32FC3);
  let currentWeight = new cv.Mat(height, width, cv.CV_32FC1);
  try {
    const rgbData = currentRgb.data32F;
    const weightData = currentWeight.data32F;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const offset = pixel * 3;
      const r = mertensGammaEncode(source[offset]);
      const g = mertensGammaEncode(source[offset + 1]);
      const b = mertensGammaEncode(source[offset + 2]);
      rgbData[offset] = r;
      rgbData[offset + 1] = g;
      rgbData[offset + 2] = b;
      const denominator = weightSums[pixel];
      const weight = openCvMertensPixelWeightEncoded(r, g, b, saturationWeight, exposureWeight);
      weightData[pixel] = denominator > 1e-20 ? weight / denominator : 1 / imageCount;
    }

    for (let level = 0; level < dimensions.length - 1; level += 1) {
      const nextDim = dimensions[level + 1];
      const nextRgb = new cv.Mat();
      const nextWeight = new cv.Mat();
      const upRgb = new cv.Mat();
      try {
        cv.pyrDown(currentRgb, nextRgb, new cv.Size(nextDim.width, nextDim.height));
        cv.pyrDown(currentWeight, nextWeight, new cv.Size(nextDim.width, nextDim.height));
        cv.pyrUp(nextRgb, upRgb, new cv.Size(currentRgb.cols, currentRgb.rows));

        const currentRgbData = currentRgb.data32F;
        const expandedRgbData = upRgb.data32F;
        const currentWeightData = currentWeight.data32F;
        const fused = fusedLevels[level];
        for (let pixel = 0; pixel < currentWeightData.length; pixel += 1) {
          const weight = currentWeightData[pixel];
          const offset = pixel * 3;
          fused[offset] += (currentRgbData[offset] - expandedRgbData[offset]) * weight;
          fused[offset + 1] += (currentRgbData[offset + 1] - expandedRgbData[offset + 1]) * weight;
          fused[offset + 2] += (currentRgbData[offset + 2] - expandedRgbData[offset + 2]) * weight;
        }
      } catch (error) {
        nextRgb.delete();
        nextWeight.delete();
        throw error;
      } finally {
        upRgb.delete();
      }
      currentRgb.delete();
      currentWeight.delete();
      currentRgb = nextRgb;
      currentWeight = nextWeight;
    }

    const lowestLevel = fusedLevels[fusedLevels.length - 1];
    const lowestRgb = currentRgb.data32F;
    const lowestWeight = currentWeight.data32F;
    for (let pixel = 0; pixel < lowestWeight.length; pixel += 1) {
      const weight = lowestWeight[pixel];
      const offset = pixel * 3;
      lowestLevel[offset] += lowestRgb[offset] * weight;
      lowestLevel[offset + 1] += lowestRgb[offset + 1] * weight;
      lowestLevel[offset + 2] += lowestRgb[offset + 2] * weight;
    }
  } finally {
    if (currentRgb) currentRgb.delete();
    if (currentWeight) currentWeight.delete();
  }
}

function reconstructMertensFusedLevels(cv, fusedLevels, dimensions, width, height) {
  let reconstructed = fusedLevels[fusedLevels.length - 1];
  for (let level = fusedLevels.length - 2; level >= 0; level -= 1) {
    const sourceDim = dimensions[level + 1];
    const targetDim = dimensions[level];
    const sourceMat = new cv.Mat(sourceDim.height, sourceDim.width, cv.CV_32FC3);
    const up = new cv.Mat();
    sourceMat.data32F.set(reconstructed);
    try {
      cv.pyrUp(sourceMat, up, new cv.Size(targetDim.width, targetDim.height));
      const next = fusedLevels[level];
      const upData = up.data32F;
      for (let i = 0; i < next.length; i += 1) next[i] += upData[i];
      reconstructed = next;
    } finally {
      sourceMat.delete();
      up.delete();
    }
  }
  return decodeMertensGammaBuffer(reconstructed, width * height * 3);
}

function buildOpenCvMertensPyramidDimensions(width, height) {
  // OpenCV MergeMertens uses floor(log2(min(width,height))) as maxlevel.
  const maxLevel = Math.max(0, Math.floor(Math.log2(Math.max(1, Math.min(width, height)))));
  const dimensions = [{ width, height }];
  for (let level = 0; level < maxLevel; level += 1) {
    const previous = dimensions[dimensions.length - 1];
    dimensions.push({
      width: Math.max(1, Math.ceil(previous.width / 2)),
      height: Math.max(1, Math.ceil(previous.height / 2)),
    });
  }
  return dimensions;
}

function accumulateOpenCvMertensWeightSums(
  image,
  width,
  height,
  saturationWeight,
  exposureWeight,
  sums,
) {
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 3;
    const r = mertensGammaEncode(image[offset]);
    const g = mertensGammaEncode(image[offset + 1]);
    const b = mertensGammaEncode(image[offset + 2]);
    sums[pixel] += openCvMertensPixelWeightEncoded(r, g, b, saturationWeight, exposureWeight);
  }
}

function openCvMertensPixelWeightEncoded(r, g, b, saturationWeight, exposureWeight) {
  let weight = 1;
  if (saturationWeight !== 0) {
    const mean = (r + g + b) / 3;
    // OpenCV uses sqrt(sum((channel - mean)^2)); it does not divide by the
    // number of channels before sqrt.
    const saturation = Math.sqrt(
      (r - mean) * (r - mean)
      + (g - mean) * (g - mean)
      + (b - mean) * (b - mean),
    );
    weight *= Math.pow(Math.max(saturation, MERTENS_WEIGHT_EPSILON), saturationWeight);
  }
  if (exposureWeight !== 0) {
    // Well-exposedness: exp(-(channel - 0.5)^2 / 0.08), multiplied across RGB.
    const dr = r - 0.5;
    const dg = g - 0.5;
    const db = b - 0.5;
    const exposedness = Math.exp(-(dr * dr + dg * dg + db * db) / 0.08);
    weight *= Math.pow(Math.max(exposedness, MERTENS_WEIGHT_EPSILON), exposureWeight);
  }
  return weight + MERTENS_WEIGHT_EPSILON;
}

function mertensGammaEncode(value) {
  return Math.pow(clamp01(value), 1 / MERTENS_PROCESSING_GAMMA);
}

function decodeMertensGammaBuffer(encoded, expectedLength) {
  const output = new Float32Array(expectedLength);
  for (let i = 0; i < expectedLength; i += 1) {
    // Laplacian reconstruction can overshoot its nominal range. Clamp before
    // inverse gamma so negative values cannot generate NaNs.
    output[i] = Math.pow(clamp01(encoded[i]), MERTENS_PROCESSING_GAMMA);
  }
  return output;
}

function validateInputs(width, height, imageBuffers, exposureTimes, brightnesses) {
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error("HDR worker received invalid image dimensions.");
  }
  if (imageBuffers.length < 2) {
    throw new Error("HDR (Debevec) requires at least two input images.");
  }
  if (exposureTimes.length !== 0 && exposureTimes.length !== imageBuffers.length) {
    throw new Error("HDR exposure-time count does not match the image count.");
  }
  if (brightnesses.length !== imageBuffers.length) {
    throw new Error("HDR brightness count does not match the image count.");
  }

  const expectedLength = width * height * 3;
  const expectedByteLength = expectedLength * Float32Array.BYTES_PER_ELEMENT;
  for (let i = 0; i < imageBuffers.length; i += 1) {
    if (!(imageBuffers[i] instanceof ArrayBuffer) || imageBuffers[i].byteLength !== expectedByteLength) {
      throw new Error(`HDR input ${i + 1} has an invalid Float32 RGB buffer.`);
    }
    if (exposureTimes.length > 0 && !(Number.isFinite(exposureTimes[i]) && exposureTimes[i] > 0)) {
      throw new Error(`HDR input ${i + 1} has an invalid exposure value.`);
    }
    if (!(Number.isFinite(brightnesses[i]) && brightnesses[i] >= 0)) {
      throw new Error(`HDR input ${i + 1} has an invalid brightness value.`);
    }
  }
}

function postProgress(message) {
  self.postMessage({ type: "progress", message });
}

function debevecWeightFloat(value) {
  const x = clamp01(value);
  if (x <= 0 || x >= 1) return HDR_FLOAT_WEIGHT_EPSILON;
  return Math.min(x, 1 - x);
}

function debevecLogResponseFloat(value) {
  // Float32 HDR1 materials are normalized linear RGB in [0,1].
  // Keep the normalized linear Float32 value continuous.  The floor is well
  // below the smallest non-zero value produced by decoding a gamma-2 Uint16
  // sample, so HDR1 does not throw away that shadow precision before log().
  return Math.log(Math.max(clamp01(value), HDR_FLOAT_MIN_RESPONSE));
}

function resolveExposureTimes(suppliedExposureTimes, brightnesses) {
  if (suppliedExposureTimes.length > 0) {
    return suppliedExposureTimes;
  }

  let minBrightness = Infinity;
  for (let i = 0; i < brightnesses.length; i += 1) {
    if (brightnesses[i] < minBrightness) minBrightness = brightnesses[i];
  }
  const denominator = Math.max(minBrightness, 0.0001);
  const exposureTimes = new Float32Array(brightnesses.length);
  for (let i = 0; i < brightnesses.length; i += 1) {
    exposureTimes[i] = Math.max(brightnesses[i] / denominator, 1e-6);
  }
  return exposureTimes;
}

function mergeDebevecWithLinearResponse(images, exposureTimes, width, height) {
  const pixelCount = width * height;
  const result = new Float32Array(pixelCount * 3);
  const logTimes = new Float64Array(exposureTimes.length);
  for (let i = 0; i < exposureTimes.length; i += 1) {
    logTimes[i] = Math.log(exposureTimes[i]);
  }

  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let weightSum = 0;

    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      const r = clamp01(image[offset]);
      const g = clamp01(image[offset + 1]);
      const b = clamp01(image[offset + 2]);
      const weight = (debevecWeightFloat(r) + debevecWeightFloat(g) + debevecWeightFloat(b)) / 3;
      const logTime = logTimes[imageIndex];
      sumR += weight * (debevecLogResponseFloat(r) - logTime);
      sumG += weight * (debevecLogResponseFloat(g) - logTime);
      sumB += weight * (debevecLogResponseFloat(b) - logTime);
      weightSum += weight;
    }

    const inverseWeight = weightSum > 0 ? 1 / weightSum : 0;
    result[offset] = sanitizeHdrValue(Math.exp(sumR * inverseWeight));
    result[offset + 1] = sanitizeHdrValue(Math.exp(sumG * inverseWeight));
    result[offset + 2] = sanitizeHdrValue(Math.exp(sumB * inverseWeight));
  }

  return result;
}

function sanitizeHdrValue(value) {
  if (Number.isNaN(value) || value === -Infinity || value < 0) return 0;
  if (value === Infinity) return 1;
  return value;
}

function tonemapReinhardInPlace(image, gamma, intensity, lightAdapt, colorAdapt) {
  // Mirrors OpenCV TonemapReinhardImpl::process().
  normalizeRgbInPlace(image);

  const pixelCount = image.length / 3;
  let sumLog = 0;
  let logMin = Infinity;
  let logMax = -Infinity;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumGray = 0;

  for (let i = 0; i < image.length; i += 3) {
    const r = image[i];
    const g = image[i + 1];
    const b = image[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const logGray = Math.log(Math.max(gray, 1e-4));
    sumLog += logGray;
    if (logGray < logMin) logMin = logGray;
    if (logGray > logMax) logMax = logGray;
    sumR += r;
    sumG += g;
    sumB += b;
    sumGray += gray;
  }

  const logMean = sumLog / pixelCount;
  const logRange = logMax - logMin;
  const key = logRange > Number.EPSILON ? (logMax - logMean) / logRange : 0.5;
  const mapKey = 0.3 + 0.7 * Math.pow(Math.max(0, key), 1.4);
  const intensityScale = Math.exp(-intensity);
  const channelMeanR = sumR / pixelCount;
  const channelMeanG = sumG / pixelCount;
  const channelMeanB = sumB / pixelCount;
  const grayMean = sumGray / pixelCount;

  for (let i = 0; i < image.length; i += 3) {
    const r = image[i];
    const g = image[i + 1];
    const b = image[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    const localR = colorAdapt * r + (1 - colorAdapt) * gray;
    const localG = colorAdapt * g + (1 - colorAdapt) * gray;
    const localB = colorAdapt * b + (1 - colorAdapt) * gray;
    const globalR = colorAdapt * channelMeanR + (1 - colorAdapt) * grayMean;
    const globalG = colorAdapt * channelMeanG + (1 - colorAdapt) * grayMean;
    const globalB = colorAdapt * channelMeanB + (1 - colorAdapt) * grayMean;

    const adaptR = lightAdapt * localR + (1 - lightAdapt) * globalR;
    const adaptG = lightAdapt * localG + (1 - lightAdapt) * globalG;
    const adaptB = lightAdapt * localB + (1 - lightAdapt) * globalB;

    const mappedAdaptR = Math.pow(Math.max(0, intensityScale * adaptR), mapKey);
    const mappedAdaptG = Math.pow(Math.max(0, intensityScale * adaptG), mapKey);
    const mappedAdaptB = Math.pow(Math.max(0, intensityScale * adaptB), mapKey);

    image[i] = r / (mappedAdaptR + r);
    image[i + 1] = g / (mappedAdaptG + g);
    image[i + 2] = b / (mappedAdaptB + b);
  }

  normalizeRgbInPlace(image);
  if (gamma !== 1) {
    const exponent = 1 / gamma;
    for (let i = 0; i < image.length; i += 1) {
      image[i] = Math.pow(Math.max(0, image[i]), exponent);
    }
  }
}

function adjustExposureToBrightnessInPlace(image, targetBrightness) {
  const target = clamp01(targetBrightness);
  let brightness = computeBrightness(image) + 1e-6;
  let distance = Math.abs(Math.log(Math.max(target, 1e-6) / brightness));
  if (distance < BRIGHTNESS_MAX_DIST) return;

  const increase = target > brightness;
  let upper = 8.0;
  let lower = 1 / upper;

  for (let attempt = 1; attempt <= BRIGHTNESS_MAX_TRIES; attempt += 1) {
    let gain = Math.sqrt(upper * lower);
    if (!increase) gain *= -1;

    const candidate = applyScaledLog(image, gain);
    brightness = computeBrightness(candidate) + 1e-6;
    distance = Math.abs(Math.log(Math.max(target, 1e-6) / brightness));
    if (distance < BRIGHTNESS_MAX_DIST || attempt >= BRIGHTNESS_MAX_TRIES) {
      image.set(candidate);
      return;
    }

    if (increase) {
      if (target > brightness) {
        if (attempt < BRIGHTNESS_MAX_TRIES / 2) upper *= 2;
        lower = gain;
      } else {
        upper = gain;
      }
    } else if (target < brightness) {
      if (attempt < BRIGHTNESS_MAX_TRIES / 2) upper *= 2;
      lower = -gain;
    } else {
      upper = -gain;
    }
  }
}

function applyScaledLog(image, factor) {
  const output = new Float32Array(image.length);
  if (factor > 1e-6) {
    const denominator = Math.log1p(factor);
    for (let i = 0; i < image.length; i += 1) {
      output[i] = clamp01(Math.log1p(image[i] * factor) / denominator);
    }
    return output;
  }
  if (factor < -1e-6) {
    const positiveFactor = -factor;
    const logFactor = Math.log1p(positiveFactor);
    for (let i = 0; i < image.length; i += 1) {
      output[i] = clamp01(Math.expm1(image[i] * logFactor) / positiveFactor);
    }
    return output;
  }
  output.set(image);
  return output;
}

function computeBrightness(image) {
  let sum = 0;
  const pixelCount = image.length / 3;
  for (let i = 0; i < image.length; i += 3) {
    sum += 0.299 * image[i] + 0.587 * image[i + 1] + 0.114 * image[i + 2];
  }
  return pixelCount > 0 ? sum / pixelCount : 0;
}

function meanArray(values) {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return sum / values.length;
}

function normalizeRgbInPlace(image) {
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < image.length; i += 1) {
    const value = image[i];
    if (!Number.isFinite(value)) continue;
    if (value < minValue) minValue = value;
    if (value > maxValue) maxValue = value;
  }

  if (!(Number.isFinite(minValue) && Number.isFinite(maxValue))) {
    throw new Error("HDR processing produced non-finite image values.");
  }
  const range = maxValue - minValue;
  if (!(range > Number.EPSILON)) return;

  const inverseRange = 1 / range;
  for (let i = 0; i < image.length; i += 1) {
    const value = image[i];
    image[i] = Number.isFinite(value) ? (value - minValue) * inverseRange : 0;
  }
}

function naiveSigmoid(x, gain, midpoint) {
  return 1 / (1 + Math.exp(-gain * (x - midpoint)));
}

function naiveInverseSigmoid(x, gain, midpoint) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const minVal = naiveSigmoid(0, gain, midpoint);
  const maxVal = naiveSigmoid(1, gain, midpoint);
  const a = (maxVal - minVal) * x + minVal;
  return -Math.log(1 / a - 1) / gain;
}

function clampSigmoid(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < -30) return -30;
  if (value > 30) return 30;
  return value;
}

function applySigmoidValue(value, gain, midpoint) {
  const x = clamp01(value);
  const g = clampSigmoid(gain);
  const mid = clamp01(midpoint);
  const gamma = 2.4;
  const encoded = Math.pow(x, 1 / gamma);
  if (g > 1e-6) {
    const minVal = naiveSigmoid(0, g, mid);
    const maxVal = naiveSigmoid(1, g, mid);
    const adjusted = clamp01((naiveSigmoid(encoded, g, mid) - minVal) / (maxVal - minVal));
    return clamp01(Math.pow(adjusted, gamma));
  }
  if (g < -1e-6) {
    const magnitude = -g;
    const minVal = naiveInverseSigmoid(0, magnitude, mid);
    const maxVal = naiveInverseSigmoid(1, magnitude, mid);
    const adjusted = clamp01((naiveInverseSigmoid(encoded, magnitude, mid) - minVal) / (maxVal - minVal));
    return clamp01(Math.pow(adjusted, gamma));
  }
  return x;
}

function applySigmoidInPlace(image, gain, midpoint) {
  for (let i = 0; i < image.length; i += 1) {
    image[i] = applySigmoidValue(image[i], gain, midpoint);
  }
}

function clamp01(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function validateMertensInputs(width, height, imageBuffers, brightnesses) {
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error("HDR2 worker received invalid image dimensions.");
  }
  if (imageBuffers.length < 2) {
    throw new Error("HDR2 (Mertens) requires at least two input images.");
  }
  if (brightnesses.length !== imageBuffers.length) {
    throw new Error("HDR2 brightness count does not match the image count.");
  }
  const expectedLength = width * height * 3;
  const expectedByteLength = expectedLength * Float32Array.BYTES_PER_ELEMENT;
  for (let i = 0; i < imageBuffers.length; i += 1) {
    if (!(imageBuffers[i] instanceof ArrayBuffer) || imageBuffers[i].byteLength !== expectedByteLength) {
      throw new Error(`HDR2 input ${i + 1} has an invalid Float32 RGB buffer.`);
    }
    if (!(Number.isFinite(brightnesses[i]) && brightnesses[i] >= 0)) {
      throw new Error(`HDR2 input ${i + 1} has an invalid brightness value.`);
    }
  }
}
