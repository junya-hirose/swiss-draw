import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repoBasePath = "/swiss-draw";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "export",
  trailingSlash: true,
  basePath: isGitHubPages ? repoBasePath : undefined,
  assetPrefix: isGitHubPages ? `${repoBasePath}/` : undefined,
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
