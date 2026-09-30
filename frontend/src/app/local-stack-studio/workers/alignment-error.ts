export type AlignmentErrorKind = "runtime" | "implementation";

export class AlignmentImplementationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlignmentImplementationError";
  }
}

export function alignmentErrorKind(error: unknown): AlignmentErrorKind {
  return error instanceof AlignmentImplementationError ? "implementation" : "runtime";
}

export function isAlignmentImplementationError(error: unknown): boolean {
  return error instanceof AlignmentImplementationError;
}

export function wrapAlignmentImplementationError(error: unknown, prefix?: string): AlignmentImplementationError {
  const detail = error instanceof Error ? error.message : String(error);
  return new AlignmentImplementationError(prefix ? `${prefix}: ${detail}` : detail);
}
