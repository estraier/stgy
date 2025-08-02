import Redis from "ioredis";

export class SendMail {
  static readonly ADDRESS_LIMIT = 1;    // 同一アドレス1分1回
  static readonly DOMAIN_LIMIT = 10;    // 同一ドメイン1分10回
  static readonly GLOBAL_LIMIT = 100;   // 全体1分100回
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
          // 古い形式（ISO文字列＋半角スペース＋アドレス）など
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

    // 判定の順番を修正
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
    // 本物の実装ならメール送信する。ここではログだけ
    console.log(`[SendMail] Sending mail to: ${address}, subject: ${subject}`);
  }
}
