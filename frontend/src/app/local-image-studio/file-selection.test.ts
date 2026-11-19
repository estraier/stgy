import { LatestFileSelection } from "./file-selection";

describe("LIS latest file selection", () => {
  test("ignores both late success and late failure from a superseded selection", async () => {
    const requests = new LatestFileSelection();
    const previous = requests.start();
    const latest = requests.start();
    const accepted: string[] = [];

    await Promise.resolve().then(() => {
      if (requests.isCurrent(latest)) accepted.push("new success");
    });
    await Promise.resolve().then(() => {
      if (requests.isCurrent(previous)) accepted.push("old success");
    });
    await Promise.reject(new Error("old failure")).catch(() => {
      if (requests.isCurrent(previous)) accepted.push("old failure");
    });
    expect(accepted).toEqual(["new success"]);
  });

  test("invalidates in-flight requests on component unmount", () => {
    const requests = new LatestFileSelection();
    const started = requests.start();
    requests.invalidate();
    expect(requests.isCurrent(started)).toBe(false);
  });
});
