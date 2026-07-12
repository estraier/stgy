import { parseFitBytes, trackActivityToTrackJson } from "stgy-track/fit";
import { prepareOriginalTrackViewBlob } from "./trackOriginal";

jest.mock("stgy-track/fit", () => ({
  parseFitBytes: jest.fn(),
  trackActivityToTrackJson: jest.fn(),
}));

const parseFitBytesMock = jest.mocked(parseFitBytes);
const trackActivityToTrackJsonMock = jest.mocked(trackActivityToTrackJson);

beforeEach(() => {
  jest.clearAllMocks();
});

test("converts a stored FIT master into full TrackJSON without downsampling", async () => {
  const sourceBytes = new Uint8Array([1, 2, 3]);
  const activity = { points: new Array(5000) };
  parseFitBytesMock.mockReturnValue(activity as never);
  trackActivityToTrackJsonMock.mockReturnValue('{"type":"FeatureCollection"}');

  const output = await prepareOriginalTrackViewBlob(
    "user/masters/ride.fit",
    new Blob([sourceBytes], { type: "application/octet-stream" }),
  );

  expect(output.type).toBe("application/json");
  await expect(output.text()).resolves.toBe('{"type":"FeatureCollection"}');
  expect(parseFitBytesMock).toHaveBeenCalledTimes(1);
  const parsedBytes = new Uint8Array(parseFitBytesMock.mock.calls[0][0]);
  expect(Array.from(parsedBytes)).toEqual([1, 2, 3]);
  expect(trackActivityToTrackJsonMock).toHaveBeenCalledWith(activity, {
    pretty: false,
  });
});

test("keeps a stored TRJGZ master compressed and normalizes its MIME type", async () => {
  const output = await prepareOriginalTrackViewBlob(
    "user/masters/ride.trjgz",
    new Blob([new Uint8Array([31, 139, 8])], { type: "application/octet-stream" }),
  );

  expect(output.type).toBe("application/gzip");
  expect(Array.from(new Uint8Array(await output.arrayBuffer()))).toEqual([31, 139, 8]);
  expect(parseFitBytesMock).not.toHaveBeenCalled();
});

test("rejects non-master display formats", async () => {
  await expect(prepareOriginalTrackViewBlob("ride.gpx", new Blob(["<gpx />"]))).rejects.toThrow(
    "Only stored FIT and TRJGZ tracks can be opened.",
  );
});
