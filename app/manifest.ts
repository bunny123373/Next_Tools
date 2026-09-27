import type { MetadataRoute } from "next";
import { CATEGORIES } from "@/lib/tools/registry";
import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — ${SITE.pitch}`,
    short_name: SITE.name,
    description: SITE.description,
    id: "/",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#050505",
    theme_color: "#050505",
    lang: "en",
    dir: "ltr",
    categories: ["utilities", "productivity", "photo", "business"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Maskable needs ~20% safe padding; the icon is designed on a full-bleed
        // field so the "B" survives an aggressive mask.
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: CATEGORIES.slice(0, 4).map((category) => ({
      name: category.name,
      short_name: category.navLabel,
      url: category.route,
    })),
  };
}
