import Redis from "ioredis";

export class SendMail {
  static readonly ADDRESS_LIMIT = 1;
  static readonly DOMAIN_LIMIT = 10;
  static readonly GLOBAL_LIMIT = 100;
  static readonly HISTORY_LIMIT = Math.ceil(SendMail.GLOBAL_LIMIT * 1.5);

  redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async canSendMail(address: string): Promise<{ ok: boolean; reason?: string }> {
    const domain = address.split("@")[1]?.toLowerCase() ?? "";
    const history = await this.redis.lrange("mail:send_history", 0, SendMail.HISTORY_LIMIT - 1);
    const now = Date.now();
    const items = history
      .map((item) => {
        try {
          const obj = JSON.parse(item);
          return {
            ts: new Date(obj.ts).getTime(),
            address: obj.address,
            domain: obj.domain,
          };
        } catch {
          const m = item.match(/^([0-9T:.Z-]+)\s+([^\s@]+@([^\s@]+))$/);
          if (m) {
            return {
              ts: new Date(m[1]).getTime(),
              address: m[2],
              domain: m[3],
            };
          }
          return null;
        }
      })
      .filter((x) => x && now - x.ts < 60000) as { ts: number; address: string; domain: string }[];

    const addressCount = items.filter((item) => item.address === address).length;
    const domainCount = items.filter((item) => item.domain === domain).length;
    const globalCount = items.length;

    if (globalCount >= SendMail.GLOBAL_LIMIT) {
      return { ok: false, reason: "global limit exceeded" };
    }
    if (domainCount >= SendMail.DOMAIN_LIMIT) {
      return { ok: false, reason: "domain limit exceeded" };
    }
    if (addressCount >= SendMail.ADDRESS_LIMIT) {
      return { ok: false, reason: "address limit exceeded" };
    }
    return { ok: true };
  }

  async recordSend(address: string): Promise<void> {
    const domain = address.split("@")[1]?.toLowerCase() ?? "";
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      address,
      domain,
    });
    await this.redis.lpush("mail:send_history", entry);
    await this.redis.ltrim("mail:send_history", 0, SendMail.HISTORY_LIMIT - 1);
  }

  async send(address: string, subject: string, body: string): Promise<void> {
    console.log(`[SendMail] Sending mail to: ${address}, subject: ${subject}, body: ${body}`);
  }
}
