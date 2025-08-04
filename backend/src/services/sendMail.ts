import Redis from "ioredis";
import nodemailer, { Transporter } from "nodemailer";

export class SendMailService {
  static readonly ADDRESS_LIMIT = 1;
  static readonly DOMAIN_LIMIT = 10;
  static readonly GLOBAL_LIMIT = 100;
  static readonly HISTORY_LIMIT = Math.ceil(SendMailService.GLOBAL_LIMIT * 1.5);

  redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  static createTransport(config?: nodemailer.TransportOptions): Transporter {
    return nodemailer.createTransport(
      config ?? {
        host: process.env.FAKEBOOK_SMTP_HOST,
        port: Number(process.env.FAKEBOOK_SMTP_PORT),
        secure: false,
        tls: {
          rejectUnauthorized: false,
        },
      },
    );
  }

  static deleteTransport(transporter: Transporter): void {
    transporter.close();
  }

  async canSendMail(address: string): Promise<{ ok: boolean; reason?: string }> {
    const domain = address.split("@")[1]?.toLowerCase() ?? "";
    const history = await this.redis.lrange(
      "mail:send_history",
      0,
      SendMailService.HISTORY_LIMIT - 1,
    );
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

    if (globalCount >= SendMailService.GLOBAL_LIMIT) {
      return { ok: false, reason: "global limit exceeded" };
    }
    if (domainCount >= SendMailService.DOMAIN_LIMIT) {
      return { ok: false, reason: "domain limit exceeded" };
    }
    if (addressCount >= SendMailService.ADDRESS_LIMIT) {
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
    await this.redis.ltrim("mail:send_history", 0, SendMailService.HISTORY_LIMIT - 1);
  }

  async send(
    transporter: Transporter,
    address: string,
    subject: string,
    body: string,
  ): Promise<void> {
    await transporter.sendMail({
      from: process.env.FAKEBOOK_SMTP_SENDER_ADDRESS,
      to: address,
      subject,
      text: body,
    });
  }
}
