/** @jest-environment jsdom */

import { applyImageFallback, NO_IMAGE_URL } from "./imageFallback";

describe("applyImageFallback", () => {
  test("replaces a failed image with no-image.svg", () => {
    const image = document.createElement("img");
    image.src = "https://example.com/missing.webp";
    image.srcset = "https://example.com/missing-2x.webp 2x";
    image.sizes = "100vw";

    expect(applyImageFallback(image)).toBe(true);
    expect(image.getAttribute("src")).toBe(NO_IMAGE_URL);
    expect(image.hasAttribute("srcset")).toBe(false);
    expect(image.hasAttribute("sizes")).toBe(false);
    expect(image.dataset.stgyImageFallback).toBe("true");
  });

  test("does not replace images with an explicit fallback", () => {
    const image = document.createElement("img");
    image.src = "https://example.com/avatar.webp";
    image.dataset.stgyNoImageFallback = "true";

    expect(applyImageFallback(image)).toBe(false);
    expect(image.getAttribute("src")).toBe("https://example.com/avatar.webp");
  });

  test("does not recursively replace the fallback itself", () => {
    const image = document.createElement("img");
    image.src = NO_IMAGE_URL;

    expect(applyImageFallback(image)).toBe(false);
  });
});
