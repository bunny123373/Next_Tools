import type { Tool } from "../types";

/**
 * Image tools.
 *
 * Every entry here is `processing: "local"` because that is literally true:
 * the workspaces decode, draw and re-encode with `createImageBitmap` and a
 * 2D canvas in the visitor's own tab. Nothing is uploaded, so there is no
 * env var, no key and no setup step.
 *
 * Icons are checked against the `ToolIconName` union, so a typo is a
 * compile error rather than a blank square.
 */
export const IMAGE_TOOLS: readonly Tool[] = [
  {
    id: "image-compressor",
    name: "Image Compressor",
    slug: "compressor",
    category: "image",
    description:
      "Shrink JPG, PNG and WebP images in your browser with a live quality slider. See the real before/after size and download one file or a ZIP of the batch.",
    intro:
      "Set a quality, press compress, and see exactly how many kilobytes you saved. If a re-encode would make a file bigger, this tool says so instead of pretending otherwise.",
    icon: "ImageDown",
    keywords: [
      "compress image",
      "reduce image size",
      "shrink jpeg",
      "optimise png",
      "image optimizer",
      "reduce photo size",
      "webp compression",
      "file size reducer",
    ],
    route: "/tools/image/compressor",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-05",
    actionLabel: "Compress",
    features: [
      "Quality slider from 10 to 100, re-encoded live in the canvas",
      "Choose the output type: keep the browser's best codec, WebP, JPEG or PNG",
      "Up to 20 images per batch, downloadable individually or as one ZIP",
      "Before/after comparison slider plus a per-file savings table",
      "Honest reporting: an output larger than the input is labelled as such",
      "Nothing is uploaded — the whole batch is processed in the tab",
    ],
    howItWorks: [
      "Your images are decoded to bitmaps on this device, one after another.",
      "Each bitmap is drawn to a canvas and re-encoded with your chosen quality and output type.",
      "The real byte size of every result is measured and compared with its original.",
      "Download the results one by one, or grab the whole batch as a ZIP.",
    ],
    faq: [
      {
        question: "Why is my compressed file sometimes bigger than the original?",
        answer:
          "An already-optimised file has very little slack to remove. A PNG of flat colour re-encoded as a photographic format, or a JPEG saved at quality 100, can come out larger. This tool reports the increase and the new size honestly instead of claiming a saving — lower the quality or keep the original.",
      },
      {
        question: "Does compressing change the image dimensions?",
        answer:
          "No. The compressor decodes to full resolution and re-encodes at the same pixel dimensions. If you also need smaller dimensions, run the result through the Image Resizer.",
      },
      {
        question: "Is the quality slider the same as what a desktop tool calls quality?",
        answer:
          "It is the same concept but a different encoder. The browser's JPEG and WebP encoders are what produce the bytes here, so the exact size at a given quality will differ slightly from Photoshop or ImageMagick — the visual result is comparable.",
      },
      {
        question: "Are my photos uploaded anywhere?",
        answer:
          "No. Decoding, drawing and encoding all happen in your browser through the Canvas API. There is no server request carrying your image, which is also why there is no size limit beyond your own memory.",
      },
    ],
    related: ["image-resizer", "image-converter", "jpg-to-webp", "png-to-jpg"],
  },
  {
    id: "image-resizer",
    name: "Image Resizer",
    slug: "resizer",
    category: "image",
    description:
      "Resize images by exact width and height, percentage presets or a locked aspect ratio. Upscaling is off by default, and the preview shows the real output size.",
    intro:
      "Type a size, drag a preset, or lock the aspect ratio and scale from whichever edge suits you. The result keeps the original format and quality stays under your control.",
    icon: "Ruler",
    keywords: [
      "resize image",
      "change image size",
      "scale image",
      "image dimensions",
      "shrink photo",
      "crop to size",
      "picture resizer",
      "set width and height",
    ],
    route: "/tools/image/resizer",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-05",
    actionLabel: "Resize",
    features: [
      "Exact width and height entry with live aspect-ratio linking",
      "Presets for 25%, 50%, 75%, 100% and 200% of the original",
      "Ratio lock that pins a custom shape such as 16:9 while you keep resizing",
      "Upscaling blocked by default, with an explicit opt-in checkbox",
      "Live preview at the target size so you can see what will come out",
      "Batch up to 20 images with per-file download or a single ZIP",
    ],
    howItWorks: [
      "The first image is decoded to read its true pixel dimensions.",
      "Your target size is resolved, with the aspect ratio and upscale rules applied.",
      "Each file is drawn to a canvas at the target size and re-encoded in its original format.",
      "Download the results individually, or as a ZIP for the whole batch.",
    ],
    faq: [
      {
        question: "Why is my resize smaller than the number I typed?",
        answer:
          "Because upscaling is off by default — a 400px image stays 400px wide when you ask for 1200, rather than being blown up into a blurry mess. Tick “Allow upscaling” if you genuinely want a larger file.",
      },
      {
        question: "What does the ratio lock do?",
        answer:
          "With “Keep aspect ratio” on, editing one field recomputes the other from the original image. The lock freezes the current shape instead, so you can set a 16:9 target on a 4:3 photo and then keep resizing inside 16:9. Turn it off to enter width and height completely independently.",
      },
      {
        question: "Does resizing recompress my image?",
        answer:
          "Yes — any canvas re-encode re-compresses. Set the quality slider near 92–100 for JPEG and WebP if you want the resample to be as invisible as possible.",
      },
      {
        question: "Is the preview the actual output?",
        answer:
          "It shows the real target dimensions and proportions in the browser, scaled down to fit. The downloaded file is rendered at full resolution, so it is sharper than the preview, not different from it.",
      },
    ],
    related: ["image-compressor", "image-cropper", "image-converter", "image-rotator"],
  },
  {
    id: "image-converter",
    name: "Image Converter",
    slug: "converter",
    category: "image",
    description:
      "Convert any browser-readable image to JPEG, PNG or WebP, with a quality control and a background colour for transparency. Unsupported codecs are reported clearly.",
    intro:
      "One tool for every direction: pick the format you need, set the quality, and convert a whole batch in a single pass. If your browser cannot write a format, we tell you before you start.",
    icon: "ImagePlus",
    features: [
      "JPEG, PNG and WebP output with a live support check per codec",
      "Quality slider for JPEG and WebP; PNG is always lossless",
      "Background colour control so transparent PNGs convert to JPEG cleanly",
      "Batch up to 20 images with per-file download or a single ZIP",
      "Before/after comparison for a single image, savings table for a batch",
      "Codec support is probed by encoding a real pixel, not guessed",
    ],
    keywords: [
      "convert image",
      "image format converter",
      "heic to jpg",
      "png to jpeg",
      "webp converter",
      "change file type",
      "picture converter",
      "avif to png",
    ],
    route: "/tools/image/converter",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-05",
    actionLabel: "Convert",
    howItWorks: [
      "A 1×1 canvas is encoded in each candidate format to find out what this browser really supports.",
      "Your images are decoded and drawn at full resolution onto a canvas.",
      "The canvas is encoded in the target format at your chosen quality.",
      "Results are measured against the originals and offered for download.",
    ],
    faq: [
      {
        question: "Which formats can it read?",
        answer:
          "Whatever your browser can decode: JPEG, PNG, WebP, GIF, AVIF and BMP on modern browsers. An animated GIF is flattened to its first frame, because a canvas holds a single bitmap.",
      },
      {
        question: "What happens to transparency when I pick JPEG?",
        answer:
          "JPEG has no alpha channel, so transparent pixels are filled with the background colour you choose. The default is white. Pick PNG or WebP if you need to keep transparency.",
      },
      {
        question: "Can it write every format everywhere?",
        answer:
          "No browser ships every encoder. The tool probes each one by encoding a real pixel, and if your browser cannot write the format you picked it says which formats it can write instead of handing you a broken download.",
      },
      {
        question: "Are the original files modified?",
        answer:
          "Never. Your input is only read. The re-encode drops EXIF, GPS and embedded colour profiles — that is a property of canvas encoding, not a choice this tool makes.",
      },
    ],
    related: ["jpg-to-png", "png-to-jpg", "image-compressor", "jpg-to-webp"],
  },
  {
    id: "jpg-to-png",
    name: "JPG to PNG",
    slug: "jpg-to-png",
    category: "image",
    description:
      "Convert JPEG photos to lossless PNG in your browser. Ideal when you need the exact pixels back — screenshots, flat graphics and anything going through further editing.",
    intro:
      "A straight, lossless JPEG-to-PNG conversion with no quality slider, because PNG has none. Expect a larger file: you are trading bytes for fidelity.",
    icon: "Layers",
    keywords: [
      "jpg to png",
      "jpeg to png",
      "convert jpg",
      "lossless conversion",
      "png converter",
      "save as png",
      "extract png from jpeg",
    ],
    route: "/tools/image/jpg-to-png",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-12",
    actionLabel: "Convert to PNG",
    features: [
      "True lossless PNG output — no quality slider, because there is nothing to tune",
      "Up to 20 JPEGs per batch, with a ZIP download",
      "Honest size report: PNG of a photo is usually much bigger, and we say so",
      "Before/after comparison for a single file",
      "Runs entirely in the tab on your device",
    ],
    howItWorks: [
      "The JPEG is decoded to a bitmap in your browser.",
      "The bitmap is drawn to a canvas at its original resolution.",
      "The canvas is encoded as PNG, which is lossless.",
      "Download the PNG, or a ZIP when you converted a batch.",
    ],
    faq: [
      {
        question: "Why is the PNG so much bigger than the JPG?",
        answer:
          "A JPEG stores a lossy, highly compressed approximation. Converting it to PNG keeps the JPEG's artefacts but stores them without any further compression, so the file usually grows several times larger. Use this when you need the exact pixels — for further editing or a lossless pipeline — not when you need a small file.",
      },
      {
        question: "Does converting to PNG restore quality that was already lost?",
        answer:
          "No. The detail the JPEG encoder threw away is gone. PNG preserves the pixels it is given perfectly, but it cannot invent what was never stored. This matters if you are hoping to undo compression artefacts by round-tripping.",
      },
      {
        question: "Can it read PNG files too?",
        answer:
          "This tool only accepts JPEG input so the result is never a guess. Use the Image Converter if you want to work from any browser-readable image.",
      },
      {
        question: "Will the output have an alpha channel?",
        answer:
          "Only if the source had transparency to begin with, which a JPEG never does. JPEG input produces a fully opaque PNG here.",
      },
    ],
    related: ["png-to-jpg", "image-converter", "image-compressor", "color-extractor"],
  },
  {
    id: "png-to-jpg",
    name: "PNG to JPG",
    slug: "png-to-jpg",
    category: "image",
    description:
      "Convert PNG to JPEG with a quality slider and a background colour for transparent areas. Flattened alpha and real size savings, entirely in your browser.",
    intro:
      "The everyday PNG-to-JPEG conversion, with the two things that actually matter: a quality control and a background fill for transparency.",
    icon: "Blend",
    keywords: [
      "png to jpg",
      "png to jpeg",
      "convert png",
      "reduce png size",
      "transparent png to jpg",
      "flatten transparency",
      "jpeg converter",
    ],
    route: "/tools/image/png-to-jpg",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-12",
    actionLabel: "Convert to JPG",
    features: [
      "Quality slider from 40 to 100 with a real byte-size readout",
      "Background colour picker for transparent regions, which JPEG cannot store",
      "Up to 20 files per batch with a ZIP download",
      "Per-file before/after savings table",
      "Fully local — the PNG is never uploaded",
    ],
    howItWorks: [
      "The PNG is decoded to a bitmap on your device.",
      "The bitmap is drawn onto a background of your chosen colour, so transparency becomes a real colour.",
      "The canvas is encoded as JPEG at the quality you set.",
      "Download the JPEG, or a ZIP for the whole batch.",
    ],
    faq: [
      {
        question: "What happens to the transparent parts of my PNG?",
        answer:
          "JPEG has no alpha channel, so they are filled with the background colour. White is the default because that is what most viewers show behind a transparent image. If your PNG is a logo meant for a dark site, pick a dark background.",
      },
      {
        question: "Why did my PNG get much smaller — did detail disappear?",
        answer:
          "Yes, some. JPEG is a lossy format: it simplifies what the eye barely notices in exchange for a large size reduction. At quality 90 or above the difference is hard to see; below 70 you will start to see blocking around edges.",
      },
      {
        question: "What quality should I use?",
        answer:
          "80–85 is a good default for photos on the web, 90+ when the image will be printed or edited again. The size readout next to the slider updates live, so you can see exactly what each step costs.",
      },
      {
        question: "Does the conversion keep my EXIF or colour profile?",
        answer:
          "No. Canvas re-encoding produces a fresh file with no metadata. If you need the original EXIF, keep the PNG — and check it with the Image Metadata Viewer first.",
      },
    ],
    related: ["jpg-to-png", "image-converter", "image-compressor", "jpg-to-webp"],
  },
  {
    id: "jpg-to-webp",
    name: "JPG to WebP",
    slug: "jpg-to-webp",
    category: "image",
    description:
      "Convert JPEG photos to WebP for a large size reduction at the same quality. Codec support is checked in your browser before you start, so you never get a broken file.",
    intro:
      "WebP usually beats JPEG on size for the same visible quality. This tool measures the saving for you and tells you plainly if your browser cannot write WebP at all.",
    icon: "Sparkles",
    keywords: [
      "jpg to webp",
      "jpeg to webp",
      "convert to webp",
      "webp converter",
      "smaller webp",
      "webp compression",
      "modern image format",
    ],
    route: "/tools/image/jpg-to-webp",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-12",
    actionLabel: "Convert to WebP",
    features: [
      "Quality slider from 40 to 100 with a live size comparison",
      "Real codec probe: the tool encodes a pixel before offering the format",
      "Up to 20 files per batch with a ZIP download",
      "Before/after comparison slider for a single image",
      "No upload, no queue, no waiting on a server",
    ],
    howItWorks: [
      "A 1×1 canvas is encoded as WebP to confirm this browser has a WebP encoder.",
      "Your JPEGs are decoded to bitmaps on your device.",
      "Each is re-encoded as WebP at the quality you chose.",
      "Download the results, individually or as a ZIP.",
    ],
    faq: [
      {
        question: "Will this work in my browser?",
        answer:
          "WebP encoding is available in Chrome, Edge, Firefox and Safari 14 and newer. The tool checks by encoding an actual pixel when the page loads and tells you which formats it can write if WebP is missing — no guessing.",
      },
      {
        question: "How much smaller is WebP than JPEG?",
        answer:
          "For photographs, usually 25–35% smaller at visually similar quality. It depends entirely on the image: a hard-edged screenshot may get bigger, and the tool will report that honestly rather than quoting you a marketing number.",
      },
      {
        question: "Can I still use WebP everywhere?",
        answer:
          "WebP is supported by every current browser, and every major platform now accepts it. If you need a format for an old email client or a specific CMS, use PNG to JPG instead.",
      },
      {
        question: "Does it keep the EXIF data?",
        answer:
          "No — the canvas encoder writes a fresh file with no metadata. Check the original with the Image Metadata Viewer if you need to know what is being dropped.",
      },
    ],
    related: ["webp-to-jpg", "image-compressor", "image-converter", "png-to-jpg"],
  },
  {
    id: "webp-to-jpg",
    name: "WebP to JPG",
    slug: "webp-to-jpg",
    category: "image",
    description:
      "Convert WebP images to universally supported JPEG, with a quality slider and a background fill for transparency. Missing codec support is reported, never hidden.",
    intro:
      "WebP is well supported, but JPEG is supported everywhere. Convert to JPEG with a quality control, and get told clearly if this browser cannot read WebP at all.",
    icon: "RefreshCw",
    keywords: [
      "webp to jpg",
      "webp to jpeg",
      "convert webp",
      "webp converter",
      "webp compatibility",
      "save webp as jpeg",
      "unsupported webp",
    ],
    route: "/tools/image/webp-to-jpg",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-12",
    actionLabel: "Convert to JPG",
    features: [
      "Quality slider from 40 to 100 for JPEG output",
      "Background colour control for transparent WebP regions",
      "Decode support is probed before you start, so failures are explained",
      "Up to 20 files per batch with a ZIP download",
      "Per-file savings table showing the real byte difference",
    ],
    howItWorks: [
      "The page checks whether this browser can both read and write the codecs involved.",
      "Each WebP is decoded to a bitmap on your device.",
      "The bitmap is drawn on a background of your chosen colour and encoded as JPEG.",
      "Download the results, individually or as a ZIP.",
    ],
    faq: [
      {
        question: "My WebP will not open. Can this tool still help?",
        answer:
          "Only if your browser can decode it. A current Chrome, Firefox, Edge or Safari can read every WebP in practice. If yours cannot, the tool says so up front instead of failing on a download — and a re-encoded WebP from an older source can occasionally be malformed enough that no browser will open it.",
      },
      {
        question: "Will my file get bigger after converting?",
        answer:
          "Sometimes. WebP is usually smaller than JPEG, so converting a well-compressed WebP back to JPEG at high quality can grow the file. The per-file table shows the real number either way.",
      },
      {
        question: "What about animated WebP?",
        answer:
          "Only the first frame is converted. A canvas holds a single still image, so animation is dropped rather than preserved.",
      },
      {
        question: "Do I need this if every browser supports WebP?",
        answer:
          "Plenty of things still do not: some email clients, older Windows software, print kiosks, and a lot of software that only lists JPEG and PNG. This tool is the escape hatch for those.",
      },
    ],
    related: ["jpg-to-webp", "image-converter", "image-compressor", "image-metadata"],
  },
  {
    id: "image-cropper",
    name: "Image Cropper",
    slug: "cropper",
    category: "image",
    description:
      "Crop images with a draggable selection, corner and edge handles, exact x/y/w/h fields and aspect presets. Works with a mouse or a finger, fully keyboard operable.",
    intro:
      "Drag out a selection — or type the numbers — then crop. The handles work with touch, the fields work with a keyboard, and the output keeps the original format.",
    icon: "Crop",
    keywords: [
      "crop image",
      "image cropper",
      "cut picture",
      "crop photo online",
      "aspect ratio crop",
      "trim image",
      "crop to square",
    ],
    route: "/tools/image/cropper",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-20",
    actionLabel: "Crop image",
    features: [
      "Drag to move the selection, drag any of the eight handles to resize",
      "Exact X, Y, width and height fields for pixel-perfect crops",
      "Aspect presets for free, 1:1, 4:3, 16:9 and 3:2",
      "Pointer-event dragging with touch support and no page-scroll fights",
      "Keyboard operation: arrow keys move and resize, every handle is focusable",
      "Full-image and centre-square shortcuts to start from somewhere sensible",
    ],
    howItWorks: [
      "The image is decoded so the selection can be tracked in real pixel coordinates.",
      "You drag, resize or type the crop rectangle; the overlay shows the exact result.",
      "Cropping to selection copies just that rectangle onto a new canvas.",
      "The canvas is encoded in the source format, or PNG when the browser cannot re-encode it.",
    ],
    faq: [
      {
        question: "Does cropping re-compress the image?",
        answer:
          "The cropped region is re-encoded, so yes. For JPEG and WebP a quality slider is available if you want to keep the recompression invisible. PNG input stays lossless.",
      },
      {
        question: "How do I crop to an exact size?",
        answer:
          "Set the aspect preset you want, then type the width — the height follows. Or turn the preset off and enter all four values. The fields are clamped to the image, so a selection can never fall off the edge.",
      },
      {
        question: "Can I crop on a phone?",
        answer:
          "Yes. The selection is dragged with pointer events and the handles disable page scrolling while you drag, so the image does not slide away under your finger.",
      },
      {
        question: "What happens to EXIF and orientation?",
        answer:
          "The browser decodes the image with its EXIF rotation already applied, so the crop matches what you see. The output contains no metadata — canvas encoding writes a clean file.",
      },
    ],
    related: ["image-resizer", "image-rotator", "image-flipper", "image-watermark"],
  },
  {
    id: "image-rotator",
    name: "Image Rotator",
    slug: "rotator",
    category: "image",
    description:
      "Rotate images in 90° steps or by any angle, optionally mirroring at the same time, with a live preview. Rotates and flips in a single re-encode.",
    intro:
      "Ninety-degree buttons for the quick fix, a free-angle slider for the rest, and optional mirroring applied in the same pass. The preview updates as you choose.",
    icon: "RotateCw",
    keywords: [
      "rotate image",
      "turn picture",
      "rotate 90 degrees",
      "flip and rotate",
      "straighten photo",
      "rotate jpg",
      "image rotation",
    ],
    route: "/tools/image/rotator",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-20",
    actionLabel: "Rotate",
    features: [
      "Rotate left and right by 90°, plus a free slider from −180° to 180°",
      "Optional horizontal and vertical mirroring applied in the same pass",
      "Live preview that re-renders as you change the angle",
      "Output size shown up front so a 90° turn is not a surprise",
      "Preserves the source format, with a quality slider for JPEG and WebP",
      "One button to go back to the unrotated original",
    ],
    howItWorks: [
      "The image is decoded to a bitmap on your device.",
      "The canvas is sized to the rotated bounding box, swapping width and height for quarter turns.",
      "Rotation is applied, then any mirror, in a single draw.",
      "The canvas is encoded and offered for download.",
    ],
    faq: [
      {
        question: "Does a 90° rotation lose quality?",
        answer:
          "Only the usual re-encode loss, because the result has to be written to a new file. Keep the quality slider at 92 or above for JPEG and WebP and the difference from the source is very hard to see.",
      },
      {
        question: "Why did my image get a black border?",
        answer:
          "At a free angle the canvas is sized to the bounding box of the rotated image, so the corners of the new canvas have nothing to draw. Stick to the 90° buttons if you need an exact edge-to-edge result.",
      },
      {
        question: "What order do the rotate and flip apply in?",
        answer:
          "Rotation first, then the mirror, in the rotated frame — the same as any photo editor. So “rotate 90° clockwise and mirror horizontally” mirrors the already-rotated picture.",
      },
      {
        question: "Can I straighten a slightly crooked photo?",
        answer:
          "Yes — use the free-angle slider for a few degrees of correction. The canvas grows to fit the rotated bounding box, and you can pick the JPEG background colour if you need a specific fill.",
      },
    ],
    related: ["image-flipper", "image-cropper", "image-resizer", "image-compressor"],
  },
  {
    id: "image-flipper",
    name: "Image Flipper",
    slug: "flipper",
    category: "image",
    description:
      "Mirror images horizontally, vertically or both at once, with a live preview. One re-encode, original format kept, nothing uploaded.",
    intro:
      "The fix for a selfie shot the wrong way round, and for scans that came out backwards. Pick a direction, check the preview, download.",
    icon: "FlipHorizontal",
    keywords: [
      "flip image",
      "mirror image",
      "reverse photo",
      "flip horizontally",
      "flip vertically",
      "mirror selfie",
      "horizontal flip",
    ],
    route: "/tools/image/flipper",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-20",
    actionLabel: "Flip",
    features: [
      "Flip horizontally, vertically, or both in a single pass",
      "Live preview that updates the moment you change direction",
      "Keeps the source format, with a quality slider for lossy formats",
      "Before/after comparison for the downloaded result",
      "Batch-friendly settings if you later process more than one image",
    ],
    howItWorks: [
      "The image is decoded to a bitmap on your device.",
      "The canvas is drawn with a mirrored transform matrix.",
      "The result is encoded in the original format.",
      "Download the flipped image.",
    ],
    faq: [
      {
        question: "What is the difference between horizontal and vertical flipping?",
        answer:
          "A horizontal flip mirrors left to right, which reverses text and fixes a mirrored selfie. A vertical flip mirrors top to bottom, which is what you need for a document scanned the wrong way up. Both at once is a 180° rotation.",
      },
      {
        question: "Does flipping change the file size much?",
        answer:
          "Slightly. A re-encode produces new bytes, and the encoder spends a little more or less effort on a mirrored image. Expect the difference to be a few percent at most.",
      },
      {
        question: "Will the text in my image still be readable?",
        answer:
          "After a horizontal flip, text reads backwards — that is what the mirror does. Combine it with a vertical flip to get a 180° turn if you need upright but reversed text.",
      },
      {
        question: "Does this keep the original quality?",
        answer:
          "It re-encodes, because a mirror is a new image. At quality 92 and above the recompression is effectively invisible.",
      },
    ],
    related: ["image-rotator", "image-cropper", "image-resizer", "image-watermark"],
  },
  {
    id: "image-blur",
    name: "Image Blur",
    slug: "blur",
    category: "image",
    description:
      "Apply a true Gaussian blur to an image with a pixel-radius slider and a live preview. If your browser has no canvas filter support, the tool says so instead of faking it.",
    intro:
      "A real blur through the canvas filter, not a fake overlay or a darkened copy. If the browser cannot do it, you get an honest explanation and not a misleading preview.",
    icon: "Wand2",
    keywords: [
      "blur image",
      "gaussian blur",
      "blurred background",
      "blur photo",
      "frosted glass image",
      "soft focus",
      "blur radius",
    ],
    route: "/tools/image/blur",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-02",
    actionLabel: "Blur",
    features: [
      "Blur radius from 0 to 40 pixels with a live preview",
      "True Gaussian blur via the canvas filter — no substitute effect",
      "Feature detection with a clear message when filters are unavailable",
      "Background colour control so the edge bleed blends as you want",
      "Quality slider for JPEG and WebP output",
      "Before/after comparison for the saved file",
    ],
    howItWorks: [
      "The page checks whether this browser implements canvas filters.",
      "Your image is decoded and drawn with a blur filter at the radius you set.",
      "A small bleed at the edges stops the filter's transparent fringe from showing.",
      "The canvas is encoded in the source format and offered for download.",
    ],
    faq: [
      {
        question: "Why does it say my browser cannot blur?",
        answer:
          "The blur uses the standard canvas `filter` property, which a few older browsers do not implement. Rather than applying a different effect and calling it a blur, the tool stops and tells you. Any current Chrome, Firefox, Edge or Safari supports it.",
      },
      {
        question: "What radius should I use?",
        answer:
          "For a background behind text, 10–20px is plenty. For censoring something, 30px and up. Remember the radius is in pixels of the source image, so a large photo needs a bigger radius than a thumbnail to look the same.",
      },
      {
        question: "Why were the edges fading?",
        answer:
          "A canvas filter samples the area outside the shape it is applied to, which is transparent, so a plain blur leaves a soft transparent fringe. The tool draws a small bleed to fill it, and for JPEG you can also set the background colour the blur blends into.",
      },
      {
        question: "Can I blur part of an image only?",
        answer:
          "Not in this tool — it blurs the whole frame. Crop the region first with the Image Cropper, then blur the crop, or watermark the full image if you need a label across it.",
      },
    ],
    related: ["image-pixelate", "image-watermark", "image-grayscale", "image-compressor"],
  },
  {
    id: "image-pixelate",
    name: "Image Pixelate",
    slug: "pixelate",
    category: "image",
    description:
      "Pixelate an image by downscaling it to a grid of large blocks and scaling it back with smoothing off. An honest mosaic, not a blur in disguise.",
    intro:
      "Pick a block size and the image is genuinely resampled into chunky squares. Nothing is faked with overlays — the detail is really gone from the pixels.",
    icon: "LayoutGrid",
    keywords: [
      "pixelate image",
      "mosaic effect",
      "pixelate photo",
      "censore photo",
      "low resolution effect",
      "blocky pixels",
      "pixel art generator",
    ],
    route: "/tools/image/pixelate",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-02",
    actionLabel: "Pixelate",
    features: [
      "Block size from 2 to 120 pixels with a live preview",
      "Real implementation: downscale, then upscale with smoothing disabled",
      "Output keeps the source dimensions, so it drops straight into a layout",
      "Background colour control for images with transparency",
      "Before/after comparison for the saved file",
    ],
    howItWorks: [
      "The image is decoded and drawn onto a canvas roughly blockSize pixels smaller in each direction.",
      "That small canvas is scaled back up to full size with image smoothing turned off.",
      "Smoothing off is what makes the browser reproduce hard square edges instead of a soft blur.",
      "The result is encoded in the source format and offered for download.",
    ],
    faq: [
      {
        question: "Is this a real pixelation or a blur that looks like one?",
        answer:
          "Real. The image is downscaled to a coarse grid and the detail is averaged away in that step, then scaled back up with smoothing disabled so the blocks stay hard-edged. You could zoom in and count the squares.",
      },
      {
        question: "Why does my block size look different on a bigger image?",
        answer:
          "The block size is in pixels of the source image. A 4000px photo at 20px blocks has 200 blocks across; a 400px thumbnail at the same setting has 20, so each block covers far more of the picture. Scale the setting roughly with the image width.",
      },
      {
        question: "Is this safe for censoring sensitive information?",
        answer:
          "It hides content convincingly at a glance, but the information is not destroyed — someone with the original still has it, and the block averages are not reversible to a meaningful degree. For a real redaction, blur the region permanently or crop it away.",
      },
      {
        question: "Can I make pixel art from a photo?",
        answer:
          "That is exactly what a large block size does. Try 40–80px on a small image: the result is the same shape as the original, made of a grid of single-colour squares.",
      },
    ],
    related: ["image-blur", "image-grayscale", "image-resizer", "image-cropper"],
  },
  {
    id: "image-grayscale",
    name: "Image Grayscale",
    slug: "grayscale",
    category: "image",
    description:
      "Convert an image to grayscale with a 0–100% strength slider and a live preview, using the canvas filter where available and a per-pixel pass where it is not.",
    intro:
      "Not just a black and white switch — a real strength control, so you can dial in a partial desaturation or commit to a full conversion.",
    icon: "Contrast",
    keywords: [
      "grayscale image",
      "black and white",
      "desaturate photo",
      "convert to greyscale",
      "monochrome image",
      "remove colour",
      "greyscale converter",
    ],
    route: "/tools/image/grayscale",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-02",
    actionLabel: "Convert to grayscale",
    features: [
      "Strength slider from 0% (unchanged) to 100% (fully grayscale)",
      "Uses the native canvas filter where available, and a per-pixel pass otherwise",
      "Live preview so you can pick the strength before downloading",
      "Keeps the source format, with a quality slider for lossy formats",
      "Before/after comparison and a real size readout",
    ],
    howItWorks: [
      "The image is decoded to a bitmap on your device.",
      "If the browser supports canvas filters, grayscale(N%) is applied while drawing — fast and exact.",
      "Otherwise each pixel is blended toward its Rec. 601 luma value in horizontal bands, which is what the filter does internally.",
      "The canvas is encoded in the source format and offered for download.",
    ],
    faq: [
      {
        question: "What does the strength slider actually do?",
        answer:
          "It blends each pixel toward its grey value by that percentage. At 0% the image is untouched, at 100% it is fully monochrome, and in between you get a desaturated look that keeps a hint of colour.",
      },
      {
        question: "Will this work in a browser without canvas filter support?",
        answer:
          "Yes. Where the filter is missing the tool falls back to a per-pixel pass that produces the same result, just slower. The page tells you which path is active so nothing is hidden.",
      },
      {
        question: "Does converting to grayscale reduce the file size?",
        answer:
          "Barely. JPEG and WebP encoders do not save much by dropping chroma, and the result is a full-colour file with grey pixels. To actually save space, compress or convert to PNG as well.",
      },
      {
        question: "What is the grey formula?",
        answer:
          "Rec. 601 luma: 0.299·R + 0.587·G + 0.114·B. That is the same weighting the CSS grayscale() filter uses, so the manual fallback and the native filter agree.",
      },
    ],
    related: ["image-pixelate", "image-blur", "image-compressor", "image-converter"],
  },
  {
    id: "image-watermark",
    name: "Image Watermark",
    slug: "watermark",
    category: "image",
    description:
      "Add a text or logo watermark to an image with a 9-position picker, opacity, size and rotation controls. Rendered in the canvas and saved into the file.",
    intro:
      "Stamp text or your own logo onto an image. Nine anchor positions, an opacity and size control, rotation, and a live preview before you commit.",
    icon: "Sticker",
    keywords: [
      "watermark image",
      "add text to photo",
      "logo overlay",
      "copyright image",
      "stamp picture",
      "image branding",
      "add watermark",
    ],
    route: "/tools/image/watermark",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-10",
    actionLabel: "Add watermark",
    features: [
      "Text watermarks with colour, size, weight, style and font family",
      "Image logo watermarks scaled as a percentage of the picture",
      "Nine-position anchor picker with a 4% margin built in",
      "Opacity from 5% to 100% and a rotation slider from −180° to 180°",
      "Live preview rendered through the same code path as the export",
      "Keeps the source format, with a quality slider for lossy outputs",
    ],
    howItWorks: [
      "Your image and, for a logo, the logo file are both decoded locally.",
      "The image is drawn to a canvas at full resolution.",
      "The text or logo is drawn on top at the chosen position, opacity, size and rotation.",
      "The canvas is encoded and offered for download.",
    ],
    faq: [
      {
        question: "Is a watermark like this removable?",
        answer:
          "Easily, if the original is not covered up. This is a deterrent and a branding tool, not protection. For anything you need to actually protect, keep the unwatermarked file private and serve a separate copy.",
      },
      {
        question: "Why does my text have a dark outline?",
        answer:
          "So it stays readable on light images without you having to pick a contrasting colour yourself. The outline is a thin stroke at 65% black; reduce the font size or use a dark image and a light colour if you do not want it.",
      },
      {
        question: "Which output format should I use for a logo?",
        answer:
          "PNG or WebP, because they keep the logo's transparency. JPEG has no alpha channel, so transparent parts of the logo get filled with the background colour you choose.",
      },
      {
        question: "Can I place the watermark anywhere I want?",
        answer:
          "At any of nine anchor points — the corners, the edge midpoints and the centre. That covers the usual cases and keeps the mark from being cropped by a platform that trims edges.",
      },
    ],
    related: ["image-cropper", "image-resizer", "image-flipper", "image-compressor"],
  },
  {
    id: "image-metadata",
    name: "Image Metadata Viewer",
    slug: "metadata",
    category: "image",
    description:
      "Inspect an image's dimensions, MIME type, size and real EXIF data — camera, lens, exposure, ISO, orientation and GPS. PNG and WebP chunk tables too.",
    intro:
      "A read-only inspector. It parses the JPEG APP1/Exif segment, the PNG chunk table and the WebP RIFF header directly, and tells you plainly when there is no metadata to find.",
    icon: "ScanEye",
    keywords: [
      "image metadata",
      "exif viewer",
      "photo metadata",
      "remove exif",
      "image properties",
      "gps coordinates photo",
      "read exif",
    ],
    route: "/tools/image/metadata",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-28",
    actionLabel: "Inspect metadata",
    features: [
      "Real EXIF parsing: orientation, capture date, make, model, exposure, aperture, ISO and focal length",
      "GPS presence and, when complete, decimal coordinates",
      "PNG chunk table with IHDR colour type, bit depth, pHYs DPI and text chunks",
      "WebP chunk list with alpha, ICC, XMP and animation flags",
      "Stored header size reported separately from the decoded, EXIF-rotated size",
      "Copy or download the report as text",
    ],
    howItWorks: [
      "A bounded prefix of the file is read and its magic bytes identify the container.",
      "JPEG files are walked segment by segment to find the APP1 Exif block and the frame header.",
      "The TIFF directory structure is parsed to read the tags, including the Exif and GPS sub-IFDs.",
      "The image is also decoded once, so the tool can report whether this browser can open it at all.",
    ],
    faq: [
      {
        question: "Why does it say there is no EXIF data?",
        answer:
          "Because there isn't any. Screenshots, exported images, messaging apps and anything that has been through a re-encode normally have their metadata stripped, and a file with no APP1 segment is reported as having no EXIF rather than being given invented values.",
      },
      {
        question: "What is the difference between the two sizes shown?",
        answer:
          "The first is what is stored in the file header. The second is what you see after EXIF orientation is applied, which is how browsers and viewers display the picture. A portrait phone photo often shows 4000×3000 stored and 3000×4000 displayed because of an orientation flag.",
      },
      {
        question: "Why are the dimensions different from what the resizer reported?",
        answer:
          "The resizer measures the decoded, oriented image — the same thing you see. This viewer reports the stored header size too, which is often what a website's alt text or a CMS records.",
      },
      {
        question: "Is the GPS data uploaded?",
        answer:
          "No. The file is read in your browser and nothing is sent anywhere. That is worth knowing precisely because the coordinates are sensitive: the same file sent to a photo-sharing service will carry them along.",
      },
      {
        question: "Can this tool remove the metadata?",
        answer:
          "Not directly — it is read-only on purpose. Any processing tool here that re-encodes through the canvas, including the compressor and resizer, produces a file with no EXIF at all, which is exactly the removal you are often after.",
      },
    ],
    related: ["image-compressor", "image-converter", "image-resizer", "color-extractor"],
  },
  {
    id: "color-extractor",
    name: "Color Extractor",
    slug: "color-extractor",
    category: "image",
    description:
      "Pull a colour palette out of any image with median-cut clustering, copy hex values, lock the ones you like, and sample a single colour by clicking the picture.",
    intro:
      "Median-cut clustering over a downscaled copy of the image gives you a real palette ordered by how much of the picture each colour covers. Click to sample, lock to keep, copy when it is right.",
    icon: "Palette",
    keywords: [
      "color extractor",
      "extract colours from image",
      "image palette",
      "hex colour picker",
      "dominant colours",
      "color palette generator",
      "sample colour photo",
    ],
    route: "/tools/image/color-extractor",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-10",
    actionLabel: "Extract palette",
    features: [
      "Median-cut clustering on a 4-bit histogram, so it stays fast on huge photos",
      "Every swatch shows its hex value and the share of the image it covers",
      "Click the preview to sample an exact pixel colour",
      "Lock the swatches you like so re-extraction keeps them",
      "Delete any swatch, or clear the sampled ones in one click",
      "Copy the palette as CSS custom properties or download it as a text file",
    ],
    howItWorks: [
      "Your image is downscaled to about 100×100 pixels — fast, and representative.",
      "Transparent pixels are dropped and the rest are bucketed into a 4-bit colour histogram.",
      "Median cut repeatedly splits the busiest box along its widest channel until you have the requested number of swatches.",
      "Each swatch is the average of its cluster, ordered by how many pixels it covers.",
    ],
    faq: [
      {
        question: "How is the palette decided?",
        answer:
          "By median cut. The colours are grouped into a histogram, the largest group is split along the channel it varies most in, and that repeats until there are as many swatches as you asked for. Each result is the average of the pixels it represents.",
      },
      {
        question: "Why does the analysis use a small version of my image?",
        answer:
          "A 100×100 downscale is about 10,000 pixels, which clusters instantly and still captures every colour that matters. Running it on 24 megapixels would take seconds and give the same answer.",
      },
      {
        question: "What do the percentages mean?",
        answer:
          "The share of visible pixels that fall into that cluster. A colour at 42% really does cover nearly half the image. Very small clusters are often compression noise near edges rather than colours you would use.",
      },
      {
        question: "Why is a colour missing that I can clearly see?",
        answer:
          "Two reasons. The clustering merges similar colours into one swatch, so two close shades become their average. And transparent pixels are excluded entirely — a PNG that is mostly transparent will produce a palette of what is actually visible.",
      },
      {
        question: "Can I sample a single exact colour?",
        answer:
          "Yes — click anywhere on the preview and the pixel's hex value is added as a sampled swatch. Sampled colours are exact, not averaged, and you can clear them all at once.",
      },
    ],
    related: ["image-watermark", "image-compressor", "image-metadata", "image-blur"],
  },
];
