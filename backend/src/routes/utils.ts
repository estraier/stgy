export function strToBool(str: string | undefined, defaultValue: boolean): boolean {
  if (typeof str !== "string") return defaultValue;
  const s = str.trim().toLowerCase();
  if (["true", "yes", "1", "on"].includes(s)) return true;
  if (["false", "no", "0", "off"].includes(s)) return false;
  return defaultValue;
}
