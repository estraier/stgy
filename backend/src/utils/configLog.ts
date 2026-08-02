const REDACTED_CONFIG_VALUE = "[redacted]";

const SENSITIVE_CONFIG_KEY_SUFFIXES = [
  "_PASSWORD",
  "_SECRET",
  "_ACCESS_KEY",
  "_ACCESS_KEY_ID",
  "_API_KEY",
  "_TOKEN",
  "_PRIVATE_KEY",
  "_CREDENTIAL",
  "_CREDENTIALS",
  "_SIGNUP_CODE",
] as const;

export function isSensitiveConfigKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  return SENSITIVE_CONFIG_KEY_SUFFIXES.some((suffix) => normalizedKey.endsWith(suffix));
}

export function redactConfigValue(key: string, value: unknown): unknown {
  return isSensitiveConfigKey(key) ? REDACTED_CONFIG_VALUE : value;
}
