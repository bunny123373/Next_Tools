import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // ffmpeg.wasm (opt-in, see docs) needs SharedArrayBuffer.
  // Enable only when you actually deploy a tool that requires it.
  async headers() {
    const headers: {
      source: string;
      headers: { key: string; value: string }[];
    }[] = [];

    const crossOriginIsolated = process.env.NEXT_PUBLIC_CROSS_ORIGIN_ISOLATED === "true";
    if (crossOriginIsolated) {
      headers.push({
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      });
    }

    return headers;
  },
  async redirects() {
    return [
      { source: "/image", destination: "/tools/image", permanent: true },
      { source: "/pdf", destination: "/tools/pdf", permanent: true },
      { source: "/video", destination: "/tools/video", permanent: true },
      { source: "/audio", destination: "/tools/audio", permanent: true },
      { source: "/text", destination: "/tools/text", permanent: true },
      { source: "/ai", destination: "/tools/ai", permanent: true },
      { source: "/developer", destination: "/tools/developer", permanent: true },
    ];
  },
};

export default nextConfig;
