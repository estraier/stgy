import { fetchRemoteHtml } from "./remoteHtml";

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
