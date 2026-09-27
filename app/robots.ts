import type { MetadataRoute } from "next";
import { SITE, absoluteUrl } from "@/lib/site";

/**
 * Private, per-user and operational areas are disallowed. Everything a visitor
 * is meant to find is allowed, including the tool pages themselves.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api/",
          "/dashboard",
          "/favorites",
          "/recent",
          "/tool-builder",
          // Query strings on /tools drive the client-side filter; the canonical
          // page is the bare path, so we keep them out of the index.
          "/tools?",
          "/tools/*?",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE.url,
  };
}
