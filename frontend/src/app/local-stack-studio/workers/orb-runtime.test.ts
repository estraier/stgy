import { isAlignmentImplementationError } from "./alignment-error";
import { createConfiguredOrb, ORB_MAX_FEATURES } from "./orb-runtime";
import type { OpenCvRuntime } from "./opencv-runtime";

describe("ORB runtime contract", () => {
  test("creates native ORB with the existing nfeatures value", () => {
    const factoryArgs: unknown[][] = [];
    class FakeOrb {
      detectAndCompute() {}
      delete() {}
      static create(...args: unknown[]) {
        factoryArgs.push(args);
        return new FakeOrb();
      }
    }
    const cv = { ORB: FakeOrb } as unknown as OpenCvRuntime;

    const orb = createConfiguredOrb(cv);

    expect(factoryArgs).toEqual([[ORB_MAX_FEATURES]]);
    expect(ORB_MAX_FEATURES).toBe(5000);
    orb.delete();
  });

  test("fails rather than probing alternate native factories", () => {
    const cv = {
      ORB_create: jest.fn(),
    } as unknown as OpenCvRuntime;

    expect(() => createConfiguredOrb(cv)).toThrow(/cv\.ORB\.create/);
    expect(cv.ORB_create).not.toHaveBeenCalled();
  });

  test("marks factory failures as implementation errors", () => {
    class BrokenOrb {
      static create() {
        throw new Error("factory unavailable");
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
      static create() { return new MalformedOrb(); }
    }
    const cv = { ORB: MalformedOrb } as unknown as OpenCvRuntime;

    expect(() => createConfiguredOrb(cv)).toThrow(/detectAndCompute/);
  });
});
