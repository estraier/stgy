import { isAlignmentImplementationError } from "./alignment-error";
import { createConfiguredOrb, ORB_MAX_FEATURES } from "./orb-runtime";
import type { OpenCvRuntime } from "./opencv-runtime";

describe("ORB runtime contract", () => {
  test("constructs ORB with the configured nfeatures value", () => {
    const constructorArgs: unknown[][] = [];
    class FakeOrb {
      detectAndCompute() {}
      delete() {}
      constructor(...args: unknown[]) {
        constructorArgs.push(args);
      }
    }
    const cv = { ORB: FakeOrb } as unknown as OpenCvRuntime;

    const orb = createConfiguredOrb(cv);

    expect(constructorArgs).toEqual([[ORB_MAX_FEATURES]]);
    expect(ORB_MAX_FEATURES).toBe(5000);
    orb.delete();
  });

  test("fails instead of probing alternative ORB factory APIs", () => {
    const cv = {
      ORB_create: jest.fn(),
    } as unknown as OpenCvRuntime;

    expect(() => createConfiguredOrb(cv)).toThrow(/cv\.ORB constructor/);
    expect(cv.ORB_create).not.toHaveBeenCalled();
  });

  test("marks constructor failures as implementation errors", () => {
    class BrokenOrb {
      constructor() {
        throw new Error("constructor unavailable");
      }
    }
    const cv = { ORB: BrokenOrb } as unknown as OpenCvRuntime;

    let caught: unknown;
    try {
      createConfiguredOrb(cv);
    } catch (error) {
      caught = error;
    }

    expect(isAlignmentImplementationError(caught)).toBe(true);
    expect(String(caught)).toContain(`nfeatures=${ORB_MAX_FEATURES}`);
  });

  test("rejects malformed ORB instances", () => {
    class MalformedOrb {
      delete() {}
    }
    const cv = { ORB: MalformedOrb } as unknown as OpenCvRuntime;

    expect(() => createConfiguredOrb(cv)).toThrow(/detectAndCompute/);
  });
});
