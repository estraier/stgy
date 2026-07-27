export class TaskWaitTimeoutError extends Error {
  constructor(
    readonly taskId: string,
    readonly timeoutMs: number,
  ) {
    super(`Timeout waiting for task ${taskId}`);
    this.name = "TaskWaitTimeoutError";
  }
}

export type TaskWaitOutcome =
  | { status: 202; result: "accepted" }
  | { status: 200; result: "completed" }
  | { status: 408; result: "timeout"; message: string };

export function parsePositiveSeconds(value: unknown): number | null {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function parsePositiveSecondsOrDefault(value: unknown, fallback: number): number {
  return parsePositiveSeconds(value) ?? fallback;
}

export async function waitForTaskOutcome(
  taskId: string,
  waitValue: unknown,
  waitTask: (taskId: string, timeoutMs: number) => Promise<void>,
): Promise<TaskWaitOutcome> {
  const waitSeconds = parsePositiveSeconds(waitValue);
  if (waitSeconds === null) return { status: 202, result: "accepted" };

  try {
    await waitTask(taskId, waitSeconds * 1000);
    return { status: 200, result: "completed" };
  } catch (error) {
    if (error instanceof TaskWaitTimeoutError) {
      return {
        status: 408,
        result: "timeout",
        message: "The task is still being processed",
      };
    }
    throw error;
  }
}
