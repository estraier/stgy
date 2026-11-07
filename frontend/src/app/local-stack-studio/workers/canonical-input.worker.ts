// Decode TIFF/JPEG/PNG/etc. to Canonical RGB entirely in a dedicated Worker.
// Each job writes its own image record and chunks into IndexedDB. No pixel
// arrays are posted to the main thread, avoiding multi-hundred-MiB copies.
import { decodeCanonicalNonRawImage } from "../stack/canonical-input-decode";
import { openCanonicalWorkerWriteSession, writeCanonicalLinearImage } from "../stack/canonical-source";
import type {
  CanonicalInputWorkerRequest,
  CanonicalInputWorkerResponse,
} from "./protocols/canonical-input-protocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<CanonicalInputWorkerRequest>) => void) | null;
  postMessage: (message: CanonicalInputWorkerResponse) => void;
};

const scope = globalThis as unknown as WorkerScope;
let busy = false;

function post(message: CanonicalInputWorkerResponse): void {
  scope.postMessage(message);
}

scope.onmessage = (event) => {
  const task = event.data;
  if (task.type !== "process") return;
  if (busy) {
    post({ type: "error", requestId: task.requestId, message: "Canonical input Worker received overlapping jobs." });
    return;
  }
  busy = true;
  void (async () => {
    try {
      if (task.inputInfo.isRaw) throw new Error("RAW inputs must use the existing LibRaw pipeline.");
      const decoded = await decodeCanonicalNonRawImage(task.file, task.inputInfo.sourceColorSpace || "srgb");
      const session = await openCanonicalWorkerWriteSession(task.sessionId);
      try {
        const record = await writeCanonicalLinearImage(
          session,
          task.imageIndex,
          task.file,
          task.inputInfo,
          decoded.width,
          decoded.height,
          decoded.linear,
          (message) => post({ type: "progress", requestId: task.requestId, message }),
        );
        post({ type: "result", requestId: task.requestId, imageIndex: task.imageIndex, record });
      } finally {
        session.db.close();
      }
    } catch (error) {
      post({
        type: "error",
        requestId: task.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      busy = false;
    }
  })();
};
