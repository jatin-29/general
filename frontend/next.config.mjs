// Static export so the frontend can be hosted on GitHub Pages (or any static host).
// NEXT_PUBLIC_BASE_PATH is "/<repo-name>" on project Pages sites; empty locally.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
};
export default nextConfig;
