"use client";

import { OUTPUT_FORMATS } from "@/lib/tools/engines/image";
import { SingleFormatConverter } from "./ImageConverterWorkspace";

const WEBP = OUTPUT_FORMATS[2];

const JPEG_INPUT = ["image/jpeg"];

export default function JpgToWebpWorkspace() {
  return (
    <SingleFormatConverter
      tool={{ id: "jpg-to-webp", category: "image", processing: "local" }}
      acceptMimes={JPEG_INPUT}
      sourceLabel="JPG"
      target={WEBP}
      defaultQuality={80}
      needsBackground={false}
      zipName="webp-converted"
      dropLabel="Drop JPG files here to convert to WebP"
      dropHint="This converter reads JPG files only, and takes up to 20 at a time. The page checks this browser for a real WebP encoder before you start."
      actionLabel="Convert to WebP"
    />
  );
}
