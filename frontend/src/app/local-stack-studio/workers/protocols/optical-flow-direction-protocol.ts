/** Internal RPC between the Optical Flow compositor and its native Flow workers. */
export type OpticalFlowDirectionRequest =
  | { type: "init"; requestId: number }
  | {
      type: "compute" | "compute-pair";
      requestId: number;
      width: number;
      height: number;
      previousGrayBuffer: ArrayBuffer;
      nextGrayBuffer: ArrayBuffer;
    };

export type OpticalFlowDirectionResponse =
  | { type: "ready"; requestId: number }
  | { type: "result"; requestId: number; flowBuffer: ArrayBuffer; computeMs: number }
  | {
      type: "pair-result";
      requestId: number;
      forwardBuffer: ArrayBuffer;
      backwardBuffer: ArrayBuffer;
      forwardMs: number;
      backwardMs: number;
    }
  | { type: "error"; requestId: number; message: string };
