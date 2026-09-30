import { asHdrWorkerRequest } from "./hdr-protocol";

describe("HDR replay protocol", () => {
  test.each([
    "merge-stream-pass2-begin",
    "merge-stream-pass2-image",
    "mertens-stream-pass2-begin",
    "mertens-stream-pass2-image",
  ])("accepts %s", (type) => {
    expect(asHdrWorkerRequest({ type, requestId: 1 })).not.toBeNull();
  });

  test("rejects unknown replay messages", () => {
    expect(asHdrWorkerRequest({ type: "mertens-stream-pass3-image", requestId: 1 })).toBeNull();
  });
});
