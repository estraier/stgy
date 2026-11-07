import type { CanonicalImageRecord, CanonicalInputInfo } from "../../stack/canonical-source";

export type CanonicalInputWorkerRequest = {
  type: "process";
  requestId: number;
  sessionId: string;
  imageIndex: number;
  file: File;
  inputInfo: CanonicalInputInfo;
};

export type CanonicalInputWorkerResponse =
  | { type: "progress"; requestId: number; message: string }
  | { type: "result"; requestId: number; imageIndex: number; record: CanonicalImageRecord }
  | { type: "error"; requestId: number; message: string };
