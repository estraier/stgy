import { isSensitiveConfigKey, redactConfigValue } from "./configLog";

describe("config log redaction", () => {
  it.each([
    "DATABASE_PASSWORD",
    "REDIS_PASSWORD",
    "OPENAI_API_KEY",
    "STORAGE_S3_ACCESS_KEY_ID",
    "STORAGE_S3_SECRET_ACCESS_KEY",
    "TEST_SIGNUP_CODE",
    "JWT_TOKEN",
    "TLS_PRIVATE_KEY",
    "SERVICE_CREDENTIALS",
  ])("redacts %s", (key) => {
    expect(isSensitiveConfigKey(key)).toBe(true);
    expect(redactConfigValue(key, "secret-value")).toBe("[redacted]");
  });

  it("matches sensitive suffixes case-insensitively", () => {
    expect(redactConfigValue("storage_s3_secret_access_key", "secret-value")).toBe("[redacted]");
  });

  it("keeps non-sensitive values unchanged", () => {
    const values: Array<[string, unknown]> = [
      ["BACKEND_PORT", 3100],
      ["FRONTEND_ORIGIN", ["http://localhost:3000"]],
      ["PASSWORD_CONFIG", "scrypt:12:20:4096:8:1"],
      ["STORAGE_S3_ENDPOINT", "http://localhost:9000"],
    ];

    for (const [key, value] of values) {
      expect(isSensitiveConfigKey(key)).toBe(false);
      expect(redactConfigValue(key, value)).toBe(value);
    }
  });
});
