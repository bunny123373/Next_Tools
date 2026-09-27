"use client";

import { OUTPUT_FORMATS } from "@/lib/tools/engines/image";
import { SingleFormatConverter } from "./ImageConverterWorkspace";

const PNG = OUTPUT_FORMATS[1];

/** Read JPEG only, so the result is never a guess. */
const JPEG_INPUT = ["image/jpeg"];

export default function JpgToPngWorkspace() {
  return (
    <SingleFormatConverter
      tool={{ id: "jpg-to-png", category: "image", processing: "local" }}
      acceptMimes={JPEG_INPUT}
      sourceLabel="JPG"
      target={PNG}
      defaultQuality={100}
      needsBackground={false}
      zipName="png-converted"
      dropLabel="Drop JPG files here to convert to PNG"
      dropHint="This converter reads JPG files only, and takes up to 20 at a time. PNG output is lossless, so the result is usually larger — that is expected, not a bug."
      actionLabel="Convert to PNG"
    />
  );
}
