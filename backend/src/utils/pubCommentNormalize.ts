export const PUB_COMMENT_NICKNAME_MAX_LENGTH = 30;
export const PUB_COMMENT_BODY_MAX_LENGTH = 1000;

function isNonCharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint <= 0x10ffff && (codePoint & 0xffff) >= 0xfffe)
  );
}

function sanitizeUnicode(input: string, keepLf: boolean): string {
  let out = "";
  for (const ch of Array.from(input)) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (isNonCharacter(cp)) continue;
    if (/\p{Cc}/u.test(ch)) {
      if (keepLf && ch === "\n") out += ch;
      continue;
    }
    out += ch;
  }
  return out.normalize("NFC");
}

function countCharacters(input: string): number {
  return Array.from(input).length;
}

export function normalizePubCommentNickname(input: unknown): string {
  if (typeof input !== "string") throw new Error("nickname is required");
  let value = input.replace(/\r\n?/g, "\n");
  value = sanitizeUnicode(value, false);
  value = value.replace(/\s+/gu, " ").trim();
  if (value.length === 0) throw new Error("nickname is required");
  if (countCharacters(value) > PUB_COMMENT_NICKNAME_MAX_LENGTH) {
    throw new Error(`nickname must be ${PUB_COMMENT_NICKNAME_MAX_LENGTH} characters or less`);
  }
  return value;
}

export function normalizePubCommentBody(input: unknown): string {
  if (typeof input !== "string") throw new Error("body is required");
  let value = input.replace(/\r\n?/g, "\n");
  value = sanitizeUnicode(value, true);

  // Remove blank lines before the first printable line.
  value = value.replace(/^(?:[^\S\n]*\n)+/u, "");
  // More than two consecutive line feeds are normalized to two.
  value = value.replace(/\n{3,}/g, "\n\n");
  // The stored form always ends immediately after the final printable character,
  // followed by exactly one LF.
  value = value.replace(/\s+$/u, "");
  if (value.length === 0) throw new Error("body is required");
  if (countCharacters(value) > PUB_COMMENT_BODY_MAX_LENGTH) {
    throw new Error(`body must be ${PUB_COMMENT_BODY_MAX_LENGTH} characters or less`);
  }
  return `${value}\n`;
}
