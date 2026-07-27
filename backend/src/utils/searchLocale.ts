export function resolvePostIndexLocale(
  postLocale: string | null | undefined,
  ownerLocale: string | null | undefined,
  defaultLocale: string | null | undefined,
): string {
  return postLocale ?? ownerLocale ?? defaultLocale ?? "en";
}
