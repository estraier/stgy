const SESSION_INDEPENDENT_PATHS = [
  "/local-image-studio",
  "/local-stack-studio",
  "/captcha-sandbox",
  "/markdown-sandbox",
  "/track-sandbox",
] as const;

export function isSessionIndependentPath(pathname: string): boolean {
  return SESSION_INDEPENDENT_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
