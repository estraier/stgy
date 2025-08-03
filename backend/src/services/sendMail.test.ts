import { SendMail } from "./sendMail";

function makeRedisMock() {
  return {
    lrange: jest.fn(),
    lpush: jest.fn(),
    ltrim: jest.fn(),
  } as any;
}

describe("SendMail", () => {
  let redisMock: any;
  let sendMail: SendMail;

  beforeEach(() => {
    redisMock = makeRedisMock();
    sendMail = new SendMail(redisMock);
  });

  it("canSendMail returns false with reason if address limit exceeded", async () => {
    redisMock.lrange.mockResolvedValue([
      JSON.stringify({
        ts: new Date().toISOString(),
        address: "user@example.com",
        domain: "example.com",
      }),
    ]);
    const result = await sendMail.canSendMail("user@example.com");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/address limit exceeded/i);
  });

  it("canSendMail returns false with reason if domain limit exceeded", async () => {
    const items = [];
    for (let i = 0; i < 10; i++) {
      items.push(
        JSON.stringify({
          ts: new Date().toISOString(),
          address: `user${i}@example.com`,
          domain: "example.com",
        }),
      );
    }
    redisMock.lrange.mockResolvedValue(items);
    const result = await sendMail.canSendMail("another@example.com");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/domain limit exceeded/i);
  });

  it("canSendMail returns false with reason if global limit exceeded", async () => {
    const items = [];
    for (let i = 0; i < 100; i++) {
      items.push(
        JSON.stringify({
          ts: new Date().toISOString(),
          address: `other${i}@other.com`,
          domain: "other.com",
        }),
      );
    }
    redisMock.lrange.mockResolvedValue(items);
    const result = await sendMail.canSendMail("user@another.com");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/global limit exceeded/i);
  });

  it("canSendMail returns true if under all limits", async () => {
    redisMock.lrange.mockResolvedValue([]);
    const result = await sendMail.canSendMail("user@example.com");
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("recordSend pushes new send record and trims history", async () => {
    redisMock.lpush.mockResolvedValue("OK");
    redisMock.ltrim.mockResolvedValue("OK");
    await sendMail.recordSend("user@example.com");
    expect(redisMock.lpush).toHaveBeenCalledWith(
      "mail:send_history",
      expect.stringContaining('"address":"user@example.com"'),
    );
    expect(redisMock.ltrim).toHaveBeenCalledWith(
      "mail:send_history",
      0,
      SendMail.HISTORY_LIMIT - 1,
    );
  });
});
