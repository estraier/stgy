import {
  AlignmentImplementationError,
  alignmentErrorKind,
  isAlignmentImplementationError,
  wrapAlignmentImplementationError,
} from "./alignment-error";

describe("alignment implementation errors", () => {
  test("marks missing implementation as non-fallback implementation errors", () => {
    const error = new AlignmentImplementationError("ORB is unavailable");
    expect(alignmentErrorKind(error)).toBe("implementation");
    expect(isAlignmentImplementationError(error)).toBe(true);
  });

  test("keeps ordinary alignment failures recoverable", () => {
    const error = new Error("not enough usable matches");
    expect(alignmentErrorKind(error)).toBe("runtime");
    expect(isAlignmentImplementationError(error)).toBe(false);
  });

  test("preserves load failure details when marking implementation errors", () => {
    const error = wrapAlignmentImplementationError(new Error("OpenCV timed out"));
    expect(error).toBeInstanceOf(AlignmentImplementationError);
    expect(error.message).toBe("OpenCV timed out");
  });
});
