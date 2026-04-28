import { TextDecoder, TextEncoder } from "util";
import { ReadableStream, WritableStream } from "stream/web";
import { TrackLoader } from "./loader";

global.TextDecoder = TextDecoder as typeof global.TextDecoder;
global.TextEncoder = TextEncoder as typeof global.TextEncoder;

describe("TrackLoader", () => {
  let loader: TrackLoader;

  beforeAll(() => {
    global.fetch = jest.fn();
  });

  beforeEach(() => {
    loader = new TrackLoader();
    document.body.innerHTML = "";
    jest.clearAllMocks();
  });

  test("parses JSON from a DOM template element", async () => {
    document.body.innerHTML = `
      <template id="test-data">
        { "type": "Feature", "properties": { "name": "test" } }
      </template>
    `;

    const data = await loader.load("#test-data");
    expect(data).toEqual({ type: "Feature", properties: { name: "test" } });
  });

  test("parses JSON directly from an application/geo+json Data URI", async () => {
    const uri = 'data:application/geo+json,{"color":"%23e74c3c"}';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "application/geo+json",
      },
      json: async () => JSON.parse(decodeURIComponent(uri.split(",")[1])),
    });

    const data = await loader.load(uri);
    expect(data.color).toBe("#e74c3c");
  });

  test("parses JSON directly from an application/json Data URI", async () => {
    const uri = 'data:application/json,{"color":"%23e74c3c"}';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "application/json",
      },
      json: async () => JSON.parse(decodeURIComponent(uri.split(",")[1])),
    });

    const data = await loader.load(uri);
    expect(data.color).toBe("#e74c3c");
  });

  test("parses gzipped TrackJSON from application/geo+json+gzip", async () => {
    const originalDecompressionStream = global.DecompressionStream;
    const body = '{ "type": "FeatureCollection", "features": [] }';

    class MockDecompressionStream {
      public readable: ReadableStream<Uint8Array>;
      public writable: WritableStream<Uint8Array>;

      constructor(_format: string) {
        const bytes = new TextEncoder().encode(body);
        this.readable = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
        this.writable = new WritableStream<Uint8Array>();
      }
    }

    global.DecompressionStream = MockDecompressionStream as unknown as typeof DecompressionStream;

    const compressedBlob = {
      size: 3,
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          },
        }),
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "application/geo+json+gzip",
      },
      blob: async () => compressedBlob,
    });

    try {
      const data = await loader.load("data:application/geo+json+gzip;base64,H4sIAAAAAAAA");
      expect(data).toEqual({ type: "FeatureCollection", features: [] });
    } finally {
      global.DecompressionStream = originalDecompressionStream;
    }
  });

  test("throws an error for unsupported MIME type", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "text/plain",
      },
      json: async () => ({}),
    });

    await expect(loader.load("data:text/plain,{}")).rejects.toThrow(
      "Track data MIME type is not supported"
    );
  });

  test("throws an error for non-existent DOM ID", async () => {
    await expect(loader.load("#not-exist")).rejects.toThrow("Track data element not found: #not-exist");
  });
});
