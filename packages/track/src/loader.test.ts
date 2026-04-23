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
    expect(data).toEqual({ type: "Feature", properties: { name: "test" } });
  });

  test("parses JSON directly from a Data URI", async () => {
    const uri = 'data:application/json,{"color":"%23e74c3c"}';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => JSON.parse(decodeURIComponent(uri.split(",")[1]))
    });

    const data = await loader.load(uri);
    expect(data.color).toBe("#e74c3c");
  });

  test("throws an error for non-existent DOM ID", async () => {
    await expect(loader.load("#not-exist")).rejects.toThrow("Track data element not found: #not-exist");
  });
});
