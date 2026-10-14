// Static export (docs: nextjs.org/docs/app/guides/static-exports, checked 2026-10-14):
// `next build` writes plain HTML/CSS/JS to out/, served by nginx on the VPS.
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  // next/image needs a custom loader under static export; the site uses plain <img>.
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
