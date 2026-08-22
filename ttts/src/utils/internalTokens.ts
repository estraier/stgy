export const INTERNAL_TOKEN_RESERVED_CHAR = "\uE000";
export const SYNTHETIC_LABEL_PREFIX = `${INTERNAL_TOKEN_RESERVED_CHAR}L`;

export function replaceInternalReservedCharWithSpace(text: string): string {
  return text.replace(/\uE000/g, " ");
}

export function makeSyntheticLabelToken(label: string): string {
  return `${SYNTHETIC_LABEL_PREFIX}${label}`;
}
