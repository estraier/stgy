import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    const isolatedHeaders = [
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
      {
        key: "Cross-Origin-Embedder-Policy",
        value: "require-corp",
      },
    ];

    // A dedicated worker started by a COEP-protected document must not
    // downgrade its embedder policy. LibRaw-Wasm runs the decoder inside
    // worker.js and the threaded Emscripten runtime may create additional
    // workers from that realm, so keep the whole threaded asset subtree under
    // the same embedder policy. COOP is a document policy and is not needed on
    // these static worker/WASM responses.
    const isolatedWorkerHeaders = [
      {
        key: "Cross-Origin-Embedder-Policy",
        value: "require-corp",
      },
      {
        key: "Cross-Origin-Resource-Policy",
        value: "same-origin",
      },
    ];

    return [
      {
        source: "/local-image-studio",
        headers: isolatedHeaders,
      },
      {
        source: "/local-stack-studio",
        headers: isolatedHeaders,
      },
      {
        source: "/vendor/libraw-wasm-threaded/:path*",
        headers: isolatedWorkerHeaders,
      },
      {
        source: "/generated/local-stack-studio/:path*",
        headers: isolatedWorkerHeaders,
      },
    ];
  },
};

export default nextConfig;
