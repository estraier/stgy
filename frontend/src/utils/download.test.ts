import { downloadUrlAsFile, filenameFromStorageKey } from "./download";

describe("filenameFromStorageKey", () => {
  it("returns the final key segment", () => {
    expect(filenameFromStorageKey("user/masters/202607/example.fit")).toBe("example.fit");
  });

  it("uses the fallback for an empty key", () => {
    expect(filenameFromStorageKey("/", "original.bin")).toBe("original.bin");
  });
});

describe("downloadUrlAsFile", () => {
  const originalFetch = global.fetch;
  const originalDocument = global.document;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(global, "document", {
      configurable: true,
      value: originalDocument,
    });
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("fetches a blob and clicks a download link", async () => {
    jest.useFakeTimers();
    const blob = new Blob(["content"], { type: "application/octet-stream" });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: jest.fn().mockResolvedValue(blob),
    }) as jest.MockedFunction<typeof fetch>;

    const click = jest.fn();
    const remove = jest.fn();
    const anchor = {
      href: "",
      download: "",
      style: { display: "" },
      click,
      remove,
    };
    const appendChild = jest.fn();
    Object.defineProperty(global, "document", {
      configurable: true,
      value: {
        createElement: jest.fn().mockReturnValue(anchor),
        body: { appendChild },
      },
    });
    URL.createObjectURL = jest.fn().mockReturnValue("blob:download");
    URL.revokeObjectURL = jest.fn();

    await downloadUrlAsFile("https://example.test/file", "original.fit");

    expect(global.fetch).toHaveBeenCalledWith("https://example.test/file");
    expect(anchor.href).toBe("blob:download");
    expect(anchor.download).toBe("original.fit");
    expect(anchor.style.display).toBe("none");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);

    jest.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });

  it("throws when the download response is not successful", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as jest.MockedFunction<typeof fetch>;

    await expect(downloadUrlAsFile("https://example.test/file", "original.fit")).rejects.toThrow(
      "Failed to download original file (403).",
    );
  });
});
