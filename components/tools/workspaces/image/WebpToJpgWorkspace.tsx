"use client";

import { OUTPUT_FORMATS } from "@/lib/tools/engines/image";
import { SingleFormatConverter } from "./ImageConverterWorkspace";

const JPEG = OUTPUT_FORMATS[0];

const WEBP_INPUT = ["image/webp"];

export default function WebpToJpgWorkspace() {
  return (
    <SingleFormatConverter
      tool={{ id: "webp-to-jpg", category: "image", processing: "local" }}
      acceptMimes={WEBP_INPUT}
      sourceLabel="WebP"
      target={JPEG}
      defaultQuality={90}
      needsBackground
      // A browser with no WebP support can neither read nor write WebP, so the
      // probe covers the decode side too.
      inputCodec="image/webp"
      zipName="jpg-converted"
      dropLabel="Drop WebP files here to convert to JPG"
      dropHint="This converter reads WebP files only, and takes up to 20 at a time. An animated WebP is flattened to its first frame."
      actionLabel="Convert to JPG"
    />
  );
}
