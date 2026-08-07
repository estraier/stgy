export const NO_IMAGE_URL = "/data/no-image.svg";

function isNoImageUrl(src: string): boolean {
  if (!src) return false;
  try {
    return new URL(src, window.location.href).pathname === NO_IMAGE_URL;
  } catch {
    return src === NO_IMAGE_URL;
  }
}

export function applyImageFallback(image: HTMLImageElement): boolean {
  const src = image.currentSrc || image.getAttribute("src") || "";
  if (image.dataset.stgyImageFallback === "true" || isNoImageUrl(src)) {
    return false;
  }

  image.dataset.stgyImageFallback = "true";
  image.removeAttribute("srcset");
  image.removeAttribute("sizes");
  image.src = NO_IMAGE_URL;
  return true;
}
