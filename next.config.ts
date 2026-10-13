import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  /**
   * Security headers.
   *
   * ffmpeg.wasm (opt-in, see docs) needs SharedArrayBuffer, which needs
   * COOP/COEP. Those stay conditional because enabling them site-wide applies
   * `require-corp` to every route and would break cross-origin fetches.
   *
   * The baseline below is unconditional and deliberately conservative. Notes on
   * the two judgement calls:
   *
   * - CSP allows 'unsafe-inline' and 'unsafe-eval' for script-src. That is not
   *   ideal, and it is not negotiable here: Next.js inlines hydration payloads
   *   and a theme bootstrap script, and ffmpeg.wasm instantiates WebAssembly
   *   from eval. The directives that DO bite — object-src, base-uri,
   *   form-action, frame-ancestors — are all locked down, so the policy stops
   *   plugin content, base-tag hijacking, form exfiltration and clickjacking
   *   even though it cannot stop an inline-script XSS. Raising that would mean
   *   a nonce or hash pipeline through the whole app; not a config edit.
   *
   * - connect-src is left open because tools legitimately fetch arbitrary
   *   user-supplied URLs (the URL converter), the FFmpeg core from unpkg, and
   *   the configured AI provider. Locking it to 'self' would break real
   *   features rather than harden anything.
   */
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

    const isProduction = process.env.NODE_ENV === "production";

    headers.push({
      source: "/(.*)",
      headers: [
        // Stop MIME sniffing turning a JSON/text response into an executable one.
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Clickjacking. Both headers: CSP for modern browsers, XFO for old ones.
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            // Tailwind and Next inject styles at runtime.
            "style-src 'self' 'unsafe-inline'",
            // Canvas exports, object URLs and inline SVG all use these schemes.
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            // ffmpeg.wasm runs its codec in a worker.
            "worker-src 'self' blob:",
            // Stripe's hosted checkout is an iframe; allow just that origin.
            "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
        },
        // Do not leak full URLs (which can carry tokens) to third parties.
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Nothing on this site uses a camera, microphone or geolocation. The
        // geolocation mention in dev.ts is help text in the header-checker tool,
        // not an API call.
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()",
        },
        ...(isProduction
          ? [
              // Only meaningful over HTTPS, which is every production deployment
              // here. Sent only in production so it cannot be pinned in dev.
              {
                key: "Strict-Transport-Security",
                value: "max-age=63072000; includeSubDomains; preload",
              },
            ]
          : []),
      ],
    });

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
