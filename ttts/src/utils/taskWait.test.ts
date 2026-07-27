import {
  parsePositiveSeconds,
  parsePositiveSecondsOrDefault,
  TaskWaitTimeoutError,
  waitForTaskOutcome,
} from "./taskWait";

describe("task wait helpers", () => {
  test("accepts fractional seconds", () => {
    expect(parsePositiveSeconds("0.1")).toBe(0.1);
    expect(parsePositiveSeconds(0.25)).toBe(0.25);
    expect(parsePositiveSecondsOrDefault("0.5", 1)).toBe(0.5);
  });

  test("uses the fallback for missing or invalid timeout values", () => {
    expect(parsePositiveSeconds(undefined)).toBeNull();
    expect(parsePositiveSeconds("0")).toBeNull();
    expect(parsePositiveSeconds("invalid")).toBeNull();
    expect(parsePositiveSecondsOrDefault("invalid", 1)).toBe(1);
  });

  test("returns 202 without waiting when wait is omitted", async () => {
    const waitTask = jest.fn<Promise<void>, [string, number]>();
    await expect(waitForTaskOutcome("d-1", undefined, waitTask)).resolves.toEqual({
      status: 202,
      result: "accepted",
    });
    expect(waitTask).not.toHaveBeenCalled();
  });

  test("returns 200 after a fractional wait completes", async () => {
    const waitTask = jest.fn<Promise<void>, [string, number]>().mockResolvedValue();
    await expect(waitForTaskOutcome("d-2", "0.25", waitTask)).resolves.toEqual({
      status: 200,
      result: "completed",
    });
    expect(waitTask).toHaveBeenCalledWith("d-2", 250);
  });

  test("returns 408 while leaving the task running after a wait timeout", async () => {
    const waitTask = jest
      .fn<Promise<void>, [string, number]>()
      .mockRejectedValue(new TaskWaitTimeoutError("d-3", 100));
    await expect(waitForTaskOutcome("d-3", "0.1", waitTask)).resolves.toEqual({
      status: 408,
      result: "timeout",
      message: "The task is still being processed",
    });
  });

  test("does not convert unrelated failures into HTTP timeouts", async () => {
    const error = new Error("queue database failed");
    const waitTask = jest.fn<Promise<void>, [string, number]>().mockRejectedValue(error);
    await expect(waitForTaskOutcome("d-4", "0.1", waitTask)).rejects.toBe(error);
  });
});
