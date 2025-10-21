import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  webpack: (config, { webpack, isServer }) => {
    if (!isServer) {
      config.plugins.push(
        new webpack.ContextReplacementPlugin(/prismjs[\\/](components)$/, /^\.\/prism-.*$/),
      );
    }
    return config;
  },
};

export default nextConfig;
