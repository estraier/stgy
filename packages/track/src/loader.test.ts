import { TrackLoader } from "./loader";

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

    expect(data).toEqual({
      type: "Feature",
      properties: {
        name: "test",
      },
    });
  });

  test("parses JSON from a non-template DOM element", async () => {
    document.body.innerHTML = `
      <script id="test-data" type="application/json">
        { "type": "FeatureCollection", "features": [] }
      </script>
    `;

    const data = await loader.load("#test-data");

    expect(data).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  test("parses JSON directly from a data URI with application/json", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockTextResponse(
      '{"color":"#e74c3c"}',
      {
        contentType: "application/json",
      }
    ));

    const data = await loader.load('data:application/json,{"color":"%23e74c3c"}');

    expect(data.color).toBe("#e74c3c");
  });

  test("parses .trj even when the server returns application/octet-stream", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockTextResponse(
      '{"type":"FeatureCollection","features":[]}',
      {
        contentType: "application/octet-stream",
      }
    ));

    const data = await loader.load("/examples/sample-track.trj");

    expect(data).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  test("parses .json and .geojson by extension", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockTextResponse('{"ok":1}', {
        contentType: "text/plain",
      }))
      .mockResolvedValueOnce(mockTextResponse('{"ok":2}', {
        contentType: "text/plain",
      }));

    await expect(loader.load("/tracks/sample.json")).resolves.toEqual({ ok: 1 });
    await expect(loader.load("/tracks/sample.geojson")).resolves.toEqual({ ok: 2 });
  });

  test("keeps query strings and hashes from breaking extension detection", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockTextResponse(
      '{"type":"FeatureCollection","features":[]}',
      {
        contentType: "application/octet-stream",
      }
    ));

    const data = await loader.load("/examples/sample-track.trj?x=1#route");

    expect(data).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  test("accepts application/geo+json by MIME type", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockTextResponse(
      '{"type":"FeatureCollection","features":[]}',
      {
        contentType: "application/geo+json; charset=utf-8",
      }
    ));

    const data = await loader.load("/track");

    expect(data).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  test("rejects unsupported MIME type when extension is unknown", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockTextResponse(
      '{"type":"FeatureCollection","features":[]}',
      {
        contentType: "text/plain",
      }
    ));

    await expect(loader.load("/track.txt")).rejects.toThrow(
      "Track data MIME type is not supported"
    );
  });

  test("throws an error for non-existent DOM ID", async () => {
    await expect(loader.load("#not-exist")).rejects.toThrow(
      "Track data element not found: #not-exist"
    );
  });

  test("throws an error for invalid JSON", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockTextResponse("{", {
      contentType: "application/json",
    }));

    await expect(loader.load("/track.trj")).rejects.toThrow("Invalid JSON");
  });

  test("throws an error for failed fetch", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      statusText: "Not Found",
      headers: makeHeaders({}),
      text: jest.fn(),
    });

    await expect(loader.load("/missing.trj")).rejects.toThrow(
      "Failed to fetch track: Not Found"
    );
  });
});

function mockTextResponse(
  text: string,
  options: {
    contentType?: string;
    contentEncoding?: string;
  } = {}
): Response {
  return {
    ok: true,
    statusText: "OK",
    headers: makeHeaders({
      "content-type": options.contentType || "",
      "content-encoding": options.contentEncoding || "",
    }),
    body: null,
    text: jest.fn().mockResolvedValue(text),
  } as unknown as Response;
}

function makeHeaders(values: Record<string, string>) {
  return {
    get: (name: string) => values[name.toLowerCase()] || null,
  };
}
