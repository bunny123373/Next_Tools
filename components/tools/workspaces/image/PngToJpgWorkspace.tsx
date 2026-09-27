"use client";

import { OUTPUT_FORMATS } from "@/lib/tools/engines/image";
import { SingleFormatConverter } from "./ImageConverterWorkspace";

const JPEG = OUTPUT_FORMATS[0];

/** Read PNG only, so the result is never a guess. */
const PNG_INPUT = ["image/png"];

export default function PngToJpgWorkspace() {
  return (
    <SingleFormatConverter
      tool={{ id: "png-to-jpg", category: "image", processing: "local" }}
      acceptMimes={PNG_INPUT}
      sourceLabel="PNG"
      target={JPEG}
      defaultQuality={85}
      needsBackground
      zipName="jpg-converted"
      dropLabel="Drop PNG files here to convert to JPG"
      dropHint="This converter reads PNG files only, and takes up to 20 at a time. Transparent areas are filled with the background colour you pick."
      actionLabel="Convert to JPG"
    />
  );
}
