import { fetchRemoteHtml, selectRemoteHtmlPrefix } from "./remoteHtml";

const options = {
  frontendOrigins: ["https://stgy.example"],
  maxBytes: 1024,
  timeoutMs: 1000,
  maxRedirects: 1,
};

describe("fetchRemoteHtml guards", () => {
  test("rejects a configured frontend host before fetching it", async () => {
    await expect(fetchRemoteHtml(new URL("https://stgy.example/posts/1"), options)).rejects.toThrow(
      "remote host is not allowed",
    );
  });

  test("rejects loopback addresses", async () => {
    await expect(fetchRemoteHtml(new URL("http://127.0.0.1/"), { ...options, frontendOrigins: [] })).rejects.toThrow(
      "remote address is not allowed",
    );
  });

  test("rejects non-standard ports", async () => {
    await expect(fetchRemoteHtml(new URL("https://example.com:8443/"), { ...options, frontendOrigins: [] })).rejects.toThrow(
      "url port is not allowed",
    );
  });
});


describe("selectRemoteHtmlPrefix", () => {
  test("stops at the closing head tag even when the full response is larger", () => {
    const source = Buffer.from(
      "<!doctype html><html><head><title>Example</title></HEAD   ><body>" +
        "x".repeat(4096) +
        "</body></html>",
    );

    const selected = selectRemoteHtmlPrefix(source, 1024);

    expect(selected.done).toBe(true);
    expect(Buffer.from(selected.bytes).toString()).toBe(
      "<!doctype html><html><head><title>Example</title></HEAD   >",
    );
  });

  test("returns at most the byte limit when the head does not close", () => {
    const source = Buffer.from("<html><head><title>Example</title>" + "x".repeat(4096));

    const selected = selectRemoteHtmlPrefix(source, 128);

    expect(selected.done).toBe(true);
    expect(selected.bytes.byteLength).toBe(128);
  });

  test("keeps waiting while the current prefix is below the byte limit", () => {
    const source = Buffer.from("<html><head><title>Example</title>");

    const selected = selectRemoteHtmlPrefix(source, 1024);

    expect(selected.done).toBe(false);
    expect(Buffer.from(selected.bytes)).toEqual(source);
  });
});
