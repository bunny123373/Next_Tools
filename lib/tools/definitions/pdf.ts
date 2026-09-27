import type { Tool } from "../types";

/**
 * PDF tools.
 *
 * Honesty rules that shaped this file:
 *  - `pdf-compress` is `beta` because true PDF compression means re-encoding
 *    embedded images, which pdf-lib cannot do. What we ship (image
 *    downsampling + stream re-compression + metadata cleanup) is real, but it
 *    is not the same thing as Ghostscript.
 *  - `pdf-protect` and `pdf-remove-password` are `setup-required` because
 *    pdf-lib cannot encrypt or decrypt PDF files at all. The UI ships; the
 *    server route does not exist yet, and we say so rather than faking a
 *    "password set!" toast.
 *  - `pdf-repair` is `beta` because a PDF that pdf-lib can parse was never
 *    badly broken; the tool reports diagnostics rather than claims a fix.
 */
export const PDF_TOOLS: readonly Tool[] = [
  {
    id: "pdf-merge",
    name: "PDF Merge",
    slug: "merge",
    category: "pdf",
    description:
      "Combine up to 30 PDFs into one document in the order you choose. Drag to reorder, merge in your browser.",
    intro:
      "Join several PDFs into a single file. The order of the pages is the order of the files in the list, and you can drag them into place before you merge.",
    icon: "Combine",
    keywords: ["combine", "join", "concatenate", "append", "merge pdf files"],
    route: "/tools/pdf/merge",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-05",
    actionLabel: "Merge PDFs",
    features: [
      "Up to 30 PDFs in one go, with a hard cap so your browser does not lock up",
      "Real page counts read from each file as you add it, not guessed from the filename",
      "Drag any file up or down to change the final page order",
      "Page rotation, links, bookmarks and form fields are preserved by the copy",
      "One download — the merged document is assembled entirely on this device",
    ],
    howItWorks: [
      "Drop your PDFs onto the dropzone, or browse for them.",
      "Check the page count beside each file and drag them into the order you want.",
      "Press Merge PDFs (or Ctrl + Enter).",
      "Download the single combined file.",
    ],
    faq: [
      {
        question: "Will merging reduce the quality of my PDFs?",
        answer:
          "No. Merging copies the existing page objects into a new document without re-encoding anything, so images stay at their original resolution and text stays selectable.",
      },
      {
        question: "Why is there a 30 file limit?",
        answer:
          "Merging holds every source document in memory at once. Thirty files is comfortably within a normal browser tab's budget, and going past that is where tabs start crashing.",
      },
      {
        question: "Are my files uploaded anywhere?",
        answer:
          "No. The whole merge runs in this tab using pdf-lib. The bytes are read into memory, written back out, and discarded when the tab closes.",
      },
      {
        question: "Can I merge a PDF that has a password on it?",
        answer:
          "No. An encrypted PDF has to be decrypted first. Use Remove PDF Password once a decryption service is configured, or open it in a reader that accepts the password and re-export it.",
      },
    ],
    related: ["pdf-split", "pdf-page-extractor", "pdf-rotator"],
  },

  {
    id: "pdf-split",
    name: "PDF Split",
    slug: "split",
    category: "pdf",
    description:
      "Split a PDF into separate files: every page on its own, into ranges like 1-3, 7, 9-12, or only the pages you select.",
    intro:
      "Break one PDF into several. Choose a rule — one file per page, fixed ranges, or a hand-picked selection — and download the pieces individually or as a ZIP.",
    icon: "Split",
    keywords: ["split", "separate", "divide", "cut", "page ranges", "extract pages"],
    route: "/tools/pdf/split",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-05",
    actionLabel: "Split PDF",
    features: [
      "Three modes: every page separately, custom ranges, or an explicit selection",
      "Range syntax you can read at a glance — \"1-3, 7, 9-12\"",
      "Each piece keeps the original page size and rotation",
      "Download pieces one by one, or grab the whole batch as a single ZIP",
      "The page count is read from the file, so the range hints are real",
    ],
    howItWorks: [
      "Drop in the PDF you want to split.",
      "Pick a mode and, if needed, type a range like 1-3, 7, 9-12.",
      "Press Split PDF (or Ctrl + Enter).",
      "Download each part, or the whole batch as a ZIP.",
    ],
    faq: [
      {
        question: "What range syntax do you accept?",
        answer:
          "Comma-separated numbers and ranges: 1-3, 7, 9-12 means pages 1, 2, 3, 7, 9, 10, 11 and 12. Ranges are inclusive on both ends, and spaces are ignored.",
      },
      {
        question: "What is the difference between Split and Page Extractor?",
        answer:
          "Split applies a rule to the whole document and produces many files. Page Extractor produces one new document from a selection of pages.",
      },
      {
        question: "Do the split files keep the original quality?",
        answer:
          "Yes. Each part is built by copying the original page objects, so nothing is re-encoded and text remains selectable.",
      },
      {
        question: "Why did my range not work?",
        answer:
          "Pages are 1-based, and the last page of the document is the limit. If a range is empty or starts after the end, the tool tells you instead of producing an empty file.",
      },
    ],
    related: ["pdf-page-extractor", "pdf-merge", "pdf-compress"],
  },

  {
    id: "pdf-compress",
    name: "PDF Compressor",
    slug: "compress",
    category: "pdf",
    description:
      "Shrink image-heavy PDFs by downsampling and re-encoding embedded images. Reports the real before/after byte counts.",
    intro:
      "A real, measurable PDF shrink for scanned and image-heavy documents: embedded images are decoded, downsampled and re-encoded as JPEG, and the result is rebuilt.",
    icon: "Gauge",
    keywords: ["compress", "reduce", "shrink", "optimise", "smaller pdf", "image downsample"],
    route: "/tools/pdf/compress",
    processing: "local",
    status: "beta",
    addedOn: "2026-01-05",
    actionLabel: "Compress",
    features: [
      "Image downsampling: JPEG, PNG and Flate images are decoded, resized and re-encoded as JPEG at your chosen quality",
      "Maximum image dimension control, so you choose the resolution ceiling",
      "Content streams are re-deflated and stale objects are dropped",
      "Optional metadata and duplicate-object cleanup pass",
      "Real before/after byte counts — if nothing could be reduced, the tool says so instead of inventing a number",
    ],
    howItWorks: [
      "Drop in a PDF — scanned documents give the biggest wins.",
      "Set the JPEG quality and the maximum image dimension.",
      "Press Compress (or Ctrl + Enter) and watch the real byte counts.",
      "Download the smaller file, or keep the original if the reduction was negligible.",
    ],
    faq: [
      {
        question: "Why is this tool marked beta?",
        answer:
          "Real PDF compression is image re-encoding at the level Ghostscript does, and a browser cannot reproduce that faithfully. What this tool does — decode, downsample, re-encode embedded images, re-deflate content streams and clean up metadata — is genuine and gives measurable savings on scanned and image-heavy files. On a text-only PDF the honest answer is often that there was nothing to gain.",
      },
      {
        question: "Will my PDF get bigger?",
        answer:
          "It can, very slightly, in one edge case: a PDF whose images are already smaller than the dimension you set but stored as a lossless format. The tool always shows the real before and after size, and tells you when the result was not smaller.",
      },
      {
        question: "Why did nothing get smaller?",
        answer:
          "Most likely it is already optimised, or it is a text-only PDF where the page content is a few kilobytes of vector drawing. There is nothing to reclaim in the browser and the tool will tell you exactly that.",
      },
      {
        question: "Does this remove text or vector content?",
        answer:
          "No. Only raster images are touched, and only when they exceed the dimension ceiling. Vector graphics, fonts and the text layer are left alone.",
      },
    ],
    related: ["pdf-merge", "pdf-split", "pdf-repair"],
  },

  {
    id: "jpg-to-pdf",
    name: "JPG to PDF",
    slug: "jpg-to-pdf",
    category: "pdf",
    description:
      "Turn JPG photos into one PDF. Real A4, Letter or fit-to-image pages, with a margin control and automatic orientation.",
    intro:
      "Stack JPG photos into a single PDF. Pick the page size, decide how much white border to leave, and drag the photos into the order you want.",
    icon: "FileImage",
    keywords: ["jpg to pdf", "jpeg to pdf", "image to pdf", "photos to pdf", "convert jpg"],
    route: "/tools/pdf/jpg-to-pdf",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-05",
    actionLabel: "Create PDF",
    features: [
      "Up to 60 photos, each landing on its own page",
      "Page size: A4, US Letter, or fit tightly to each image",
      "Auto orientation so a landscape photo does not sit sideways on a portrait page",
      "Adjustable margin from 0 to 50 points",
      "Drag to reorder before you create the document",
    ],
    howItWorks: [
      "Drop in your JPG files.",
      "Choose A4, Letter or fit-to-image, then set the margin.",
      "Drag the photos into order and press Create PDF (or Ctrl + Enter).",
      "Download the finished document.",
    ],
    faq: [
      {
        question: "Does converting a JPG to PDF reduce image quality?",
        answer:
          "No. The original JPEG bytes are embedded as-is. Only the page canvas around the image is added.",
      },
      {
        question: "What does fit to image do?",
        answer:
          "It makes each page exactly the pixel dimensions of the photo, converted to PDF points, with no margin. That is the right choice for a photo album or a gallery PDF.",
      },
      {
        question: "Why is my landscape photo rotated?",
        answer:
          "On a fixed page size such as A4, auto orientation rotates the page box so the photo still reads the right way up. Switch orientation to portrait or landscape to override it.",
      },
      {
        question: "Can I convert JPG and PNG together in one file?",
        answer:
          "Not in this tool — it is scoped to JPG so the conversion is predictable. Use the PNG to PDF tool for PNG files; the two produce the same kind of document.",
      },
    ],
    related: ["png-to-pdf", "pdf-merge", "pdf-to-jpg"],
  },

  {
    id: "png-to-pdf",
    name: "PNG to PDF",
    slug: "png-to-pdf",
    category: "pdf",
    description:
      "Turn PNG images into a single PDF with real page sizes, a margin control and automatic orientation. Runs locally.",
    intro:
      "Convert PNG images into one PDF. Every image gets its own page, on A4, US Letter or sized to fit the image exactly.",
    icon: "ImagePlus",
    keywords: ["png to pdf", "image to pdf", "convert png", "screenshots to pdf"],
    route: "/tools/pdf/png-to-pdf",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-18",
    actionLabel: "Create PDF",
    features: [
      "Up to 60 images, each landing on its own page",
      "Page size: A4, US Letter, or fit tightly to each image",
      "Auto orientation and a margin control from 0 to 50 points",
      "Lossless — the PNG data is embedded without re-encoding",
      "Reorder by dragging before you create the document",
    ],
    howItWorks: [
      "Drop in your PNG files.",
      "Choose A4, Letter or fit-to-image, then set the margin.",
      "Drag the images into order and press Create PDF (or Ctrl + Enter).",
      "Download the finished document.",
    ],
    faq: [
      {
        question: "Is the PNG re-compressed?",
        answer:
          "No. PNG is embedded losslessly, so a screenshot in a PDF looks exactly like the original file.",
      },
      {
        question: "Why is my PDF huge when my PNGs are small?",
        answer:
          "PNG is an already-compressed lossless format, so there is nothing left to squeeze. The PDF size will be close to the sum of the PNGs plus a few kilobytes of page structure per image.",
      },
      {
        question: "Can I add a password to the result?",
        answer:
          "Not from this tool. PDF Password Protect needs a server-side encryption service that this deployment has not configured yet.",
      },
    ],
    related: ["jpg-to-pdf", "pdf-merge", "pdf-to-jpg"],
  },

  {
    id: "pdf-to-jpg",
    name: "PDF to JPG",
    slug: "pdf-to-jpg",
    category: "pdf",
    description:
      "Render PDF pages to JPG or PNG at the DPI you choose. Click page thumbnails to pick, then download individually or as a ZIP.",
    intro:
      "Turn PDF pages into images. Set the resolution, choose JPEG or PNG, click the thumbnails for the pages you want, and export.",
    icon: "Images",
    keywords: ["pdf to jpg", "pdf to image", "pdf to png", "rasterise", "export pdf pages"],
    route: "/tools/pdf/pdf-to-jpg",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-18",
    actionLabel: "Export images",
    features: [
      "Any resolution between 72 and 600 DPI, applied to real page geometry",
      "JPEG or PNG output — JPEG for photos, PNG for text and line art",
      "A thumbnail grid you can click to include or exclude each page",
      "Quality slider for JPEG, so you can trade size for fidelity on purpose",
      "Download each image, or the whole batch as one ZIP",
    ],
    howItWorks: [
      "Drop in the PDF.",
      "Choose a page range, a DPI value and an output format.",
      "Click thumbnails to select the pages you want.",
      "Press Export images (or Ctrl + Enter) and download the batch.",
    ],
    faq: [
      {
        question: "What DPI should I use?",
        answer:
          "72 DPI matches a screen, 150 DPI is fine for a document read on screen, and 300 DPI is the usual floor for printing. Above 300 the file grows quickly for little visible gain.",
      },
      {
        question: "Should I choose JPEG or PNG?",
        answer:
          "JPEG for photographs and anything with lots of continuous tone. PNG for text, screenshots and line art, where JPEG's artefacts around letters are ugly.",
      },
      {
        question: "Is the text still selectable in the output?",
        answer:
          "No. A rendered image is pixels. If you need selectable text, use PDF to Text instead.",
      },
      {
        question: "Why is the output bigger than I expected?",
        answer:
          "A4 at 300 DPI is about 2480 by 3508 pixels per page. Times fifty pages that is a lot of pixels. Lower the DPI or select fewer pages if the ZIP is unwieldy.",
      },
    ],
    related: ["pdf-to-text", "pdf-page-extractor", "jpg-to-pdf"],
  },

  {
    id: "pdf-page-extractor",
    name: "PDF Page Extractor",
    slug: "page-extractor",
    category: "pdf",
    description:
      "Pull chosen pages out of a PDF into one new document. Type a range or click page thumbnails to select them.",
    intro:
      "Keep only the pages you need. Type a range like 1-3, 7 or click the thumbnails, and the tool builds a single new PDF from your selection.",
    icon: "Scissors",
    keywords: ["extract pages", "select pages", "pick pages", "remove pages", "subset pdf"],
    route: "/tools/pdf/page-extractor",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-25",
    actionLabel: "Extract pages",
    features: [
      "Type a range, click thumbnails, or do both — the two stay in sync",
      "Select all and none, or invert the current selection, in one click",
      "A live count of exactly how many pages are selected",
      "One output document, original page order and rotation preserved",
      "A real first-page preview so you can see what you picked",
    ],
    howItWorks: [
      "Drop in the PDF.",
      "Click page thumbnails, or type a range such as 2-4, 9.",
      "Press Extract pages (or Ctrl + Enter).",
      "Download the new document.",
    ],
    faq: [
      {
        question: "Does extracting pages shrink the file?",
        answer:
          "Usually yes, because the pages you do not keep — and the images and fonts only they referenced — are never copied into the new document.",
      },
      {
        question: "What happens to links and bookmarks?",
        answer:
          "The selected pages keep their own links and form fields. Document-level bookmarks and outlines are not carried across, because they belong to the original document structure.",
      },
      {
        question: "Can I extract pages in a different order?",
        answer:
          "No. Pages come out in the document's original order, which is what almost everyone needs. If you want a specific order, use PDF Split and merge the pieces in the order you want.",
      },
    ],
    related: ["pdf-split", "pdf-merge", "pdf-rotator"],
  },

  {
    id: "pdf-rotator",
    name: "PDF Page Rotator",
    slug: "rotator",
    category: "pdf",
    description:
      "Rotate all pages or just the ones you select by 90, 180 or 270 degrees, with a live first-page preview.",
    intro:
      "Turn a sideways scan the right way up. Rotate every page or a hand-picked selection, and check the result on a live preview before you download.",
    icon: "RotateCw",
    keywords: ["rotate pdf", "turn pages", "fix orientation", "landscape to portrait", "90 degrees"],
    route: "/tools/pdf/rotator",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-25",
    actionLabel: "Rotate pages",
    features: [
      "Rotate all pages, or only the ones you tick in the thumbnail grid",
      "90, 180 or 270 degree turns, applied relative to the current rotation",
      "Live preview of the first selected page, rendered from the real file",
      "Rotation is stored as page metadata, so no pixels are re-encoded",
      "Works on the selection only, which is what most scans actually need",
    ],
    howItWorks: [
      "Drop in the PDF.",
      "Choose all pages or a selection, and pick an angle.",
      "Check the preview, then press Rotate pages (or Ctrl + Enter).",
      "Download the rotated document.",
    ],
    faq: [
      {
        question: "Does rotating re-encode the page?",
        answer:
          "No. Rotation is a value stored in the page dictionary, so the file size barely changes and nothing is recompressed.",
      },
      {
        question: "How do I get from 90 degrees back to upright?",
        answer:
          "Each turn is relative to the current rotation, so 90 three times is 270 and four times returns to the original. Pick 270 to undo a single 90-degree turn.",
      },
      {
        question: "Can I flip a page upside down?",
        answer:
          "A 180 degree rotation is the closest PDF has to a flip, and for a scanned page it is exactly what you want. A true horizontal mirror is not a PDF page operation.",
      },
    ],
    related: ["pdf-page-extractor", "pdf-split", "pdf-watermark"],
  },

  {
    id: "pdf-page-numbers",
    name: "PDF Page Numbers",
    slug: "page-numbers",
    category: "pdf",
    description:
      "Add page numbers to a PDF in six positions, with your own format, start value and font size. Drawn locally with pdf-lib.",
    intro:
      "Stamp page numbers onto a PDF. Choose where they sit, what the label looks like, which page to start counting from, and whether to skip the cover.",
    icon: "ListOrdered",
    keywords: ["page numbers", "number pages", "paginate", "footer", "page numbering"],
    route: "/tools/pdf/page-numbers",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-08",
    actionLabel: "Add page numbers",
    features: [
      "Six positions: top or bottom, centred, left or right",
      "Formats: plain number, \"Page 3 of 12\", or \"- 3 -\"",
      "Start counting at any number, for documents continued from an earlier volume",
      "Optionally skip the first page, the usual treatment for a cover",
      "Font size control, drawn with the built-in Helvetica so nothing needs embedding",
    ],
    howItWorks: [
      "Drop in the PDF.",
      "Pick a position, a format, a start number and a size.",
      "Press Add page numbers (or Ctrl + Enter).",
      "Download the numbered document.",
    ],
    faq: [
      {
        question: "Why does the numbering use a different font from my document?",
        answer:
          "It uses Helvetica from the PDF standard 14 fonts, because embedding a custom typeface needs a font parser that a browser-only tool cannot ship safely. Helvetica is available on every reader.",
      },
      {
        question: "Does the total include pages I skipped?",
        answer:
          "Yes. The total is the real page count of the document, so \"Page 3 of 12\" stays correct even when the cover is skipped.",
      },
      {
        question: "Can I number only some pages?",
        answer:
          "This tool numbers the whole document, optionally skipping the first page. For anything more selective, split the document first and number the piece you care about.",
      },
    ],
    related: ["pdf-watermark", "pdf-rotator", "pdf-merge"],
  },

  {
    id: "pdf-watermark",
    name: "PDF Watermark",
    slug: "watermark",
    category: "pdf",
    description:
      "Stamp diagonal or tiled text watermarks onto a PDF. Control opacity, colour, size, angle and page range.",
    intro:
      "Mark a document as DRAFT, CONFIDENTIAL or anything else. One large diagonal mark or a tiled grid, applied to the pages you choose.",
    icon: "Sticker",
    keywords: ["watermark", "stamp", "draft", "confidential", "diagonal text", "tiled"],
    route: "/tools/pdf/watermark",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-08",
    actionLabel: "Add watermark",
    features: [
      "Single diagonal mark or a tiled grid across the whole page",
      "Any text, any opacity between 5% and 100%, any angle",
      "Colour picker plus a greyscale and brand-red preset",
      "Apply to every page or to a range such as 2-8",
      "Font size control, with the built-in standard font so nothing needs embedding",
    ],
    howItWorks: [
      "Drop in the PDF.",
      "Type your text and set mode, opacity, size, angle and colour.",
      "Press Add watermark (or Ctrl + Enter).",
      "Download the watermarked document.",
    ],
    faq: [
      {
        question: "Can the watermark be removed again?",
        answer:
          "Not with this tool. The mark is drawn into the page content. To take it off you need the original document, or a tool that can identify and strip the drawn operators.",
      },
      {
        question: "Why does the watermark sit on top of my text?",
        answer:
          "It is drawn after the existing content, so it is in front. Lower the opacity if you need the text underneath to stay readable.",
      },
      {
        question: "Does watermarking reduce quality?",
        answer:
          "No. It adds a small text-drawing operator to the page. The existing content, images and fonts are untouched.",
      },
    ],
    related: ["pdf-page-numbers", "pdf-rotator", "pdf-merge"],
  },

  {
    id: "pdf-metadata",
    name: "PDF Metadata Viewer",
    slug: "metadata",
    category: "pdf",
    description:
      "See the real title, author, producer, dates and encryption state inside a PDF, then set new values or strip all metadata.",
    intro:
      "Open a PDF's document properties. Title, author, subject, keywords, creator, producer and the creation and modification dates are read straight from the file.",
    icon: "Tags",
    keywords: ["pdf metadata", "document properties", "exif", "author", "producer", "strip metadata"],
    route: "/tools/pdf/metadata",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-28",
    actionLabel: "Read metadata",
    features: [
      "The real info dictionary, read from the file rather than inferred from its name",
      "Page count and the distinct page sizes in the document",
      "Encryption state and whether an XMP metadata stream is present",
      "Set a new title, author, subject, keywords, creator and producer",
      "Remove all metadata in one action — useful before sharing a document publicly",
    ],
    howItWorks: [
      "Drop in the PDF.",
      "Read the properties panel to see what is actually in the file.",
      "Edit values in the form, or press Remove all metadata.",
      "Press Save changes (or Ctrl + Enter) and download the updated document.",
    ],
    faq: [
      {
        question: "Does removing metadata really delete it?",
        answer:
          "It clears the info dictionary and the XMP stream and rewrites the file, so ordinary PDF readers no longer show the values. It is not forensic erasure: anything drawn into the page content itself stays.",
      },
      {
        question: "Why does my PDF have no author?",
        answer:
          "Because it never had one. Plenty of generators write an empty info dictionary, and a file that has been through several tools often has everything stripped.",
      },
      {
        question: "What is the difference between Creator and Producer?",
        answer:
          "Producer is the program that wrote the file, Creator is what the document claims was used to create the original content. They are often the same string, which is why it is worth checking before sharing.",
      },
    ],
    related: ["pdf-repair", "pdf-compress", "pdf-watermark"],
  },

  {
    id: "pdf-to-text",
    name: "PDF to Text",
    slug: "to-text",
    category: "pdf",
    description:
      "Extract the embedded text layer from a PDF to plain text, page by page. Honest about scanned pages that have no text.",
    intro:
      "Pull the text layer out of a PDF. Line breaks follow the real positions in the file, and a scanned page with no text layer is reported as exactly that.",
    icon: "ScrollText",
    keywords: ["pdf to text", "extract text", "copy text", "text layer", "ocr"],
    route: "/tools/pdf/to-text",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-15",
    actionLabel: "Extract text",
    features: [
      "Reads the real text layer, not OCR, using PDF.js",
      "Line breaks are inserted where the text actually moves down the page",
      "Optional page headers so you can tell where one page ends and the next begins",
      "Word count, character count and per-page counts in the result",
      "A scanned PDF with no text layer is detected and reported, not silently returned as empty",
    ],
    howItWorks: [
      "Drop in the PDF.",
      "Choose a page range and whether to insert page separators.",
      "Press Extract text (or Ctrl + Enter).",
      "Copy the text or download it as a .txt file.",
    ],
    faq: [
      {
        question: "My PDF has text on the page but I get nothing back. Why?",
        answer:
          "It is almost certainly a scan. A scanned page is a picture of text, so there is no text layer to read. This is not OCR, and the tool tells you when it finds this case instead of handing you an empty file.",
      },
      {
        question: "Can you OCR a scanned PDF?",
        answer:
          "No. OCR needs a trained model that is far too large to ship in a browser tab, and running it well needs a server. Use an OCR service or the AI tools instead.",
      },
      {
        question: "Why is the column order wrong on my PDF?",
        answer:
          "PDF stores text as positioned glyph runs, not as a paragraph structure. Extraction follows the order the producer wrote, which for a multi-column layout is rarely reading order. A structured extractor is the only real fix.",
      },
      {
        question: "Is my document uploaded?",
        answer:
          "No. PDF.js parses the file in this tab. The extracted text never leaves your device unless you copy or download it yourself.",
      },
    ],
    related: ["pdf-to-jpg", "pdf-page-extractor", "pdf-metadata"],
  },

  {
    id: "pdf-repair",
    name: "PDF Repair",
    slug: "repair",
    category: "pdf",
    description:
      "Rebuild a PDF's cross-reference table and re-save it. Reports exactly what was fixed, or that nothing was wrong.",
    intro:
      "Open a PDF that some readers reject, rewrite its cross-reference table, and get a clean file back — with a real list of what changed.",
    icon: "Wrench",
    keywords: ["repair pdf", "fix pdf", "corrupt", "damaged", "xref", "recover pdf"],
    route: "/tools/pdf/repair",
    processing: "local",
    status: "beta",
    addedOn: "2026-02-15",
    actionLabel: "Repair PDF",
    features: [
      "Rewrites the file with a freshly generated cross-reference table and trailer",
      "Drops indirect objects that nothing references any more",
      "Reports orphaned objects removed and objects parsed, with real counts",
      "Says plainly when the file loaded without errors and needed nothing",
      "Produces a re-saved document that opens in any standards-compliant reader",
    ],
    howItWorks: [
      "Drop in the PDF that will not open.",
      "Press Repair PDF (or Ctrl + Enter).",
      "Read the diagnostics — what was rebuilt, or that nothing was wrong.",
      "Download the rewritten file if a rewrite happened.",
    ],
    faq: [
      {
        question: "My PDF is damaged, will this fix it?",
        answer:
          "Sometimes, and it will always tell you which. What this tool does is rewrite the file: a freshly generated cross-reference table, a proper end-of-file marker, orphaned objects dropped, and the trailer dictionary normalised. What it cannot do is parse a file whose cross-reference table is gone entirely — a browser has no way to find objects that were never indexed, so the tool reports that plainly instead of pretending.",
      },
      {
        question: "Why does it say my PDF loaded without errors?",
        answer:
          "Because it did. A PDF that parses cleanly was never badly broken, and inventing a repair for a healthy file would be a lie. The tool reports the healthy state instead.",
      },
      {
        question: "Why is this beta?",
        answer:
          "The repair is a structural rewrite, not a recovery of lost data. It reliably helps with files that have junk appended, a missing end-of-file marker, dead objects from a botched edit, or a trailer a strict reader rejects — and it reliably cannot help with content that is physically gone. The diagnostics are always real measurements, never a guess.",
      },
      {
        question: "What does \"orphaned objects\" mean?",
        answer:
          "Objects still in the file that nothing points at any more — usually left over from an earlier edit. They are dead weight, and the repair drops them and reports the count.",
      },
    ],
    related: ["pdf-metadata", "pdf-compress", "pdf-merge"],
  },

  {
    id: "pdf-protect",
    name: "PDF Password Protect",
    slug: "protect",
    category: "pdf",
    description:
      "Add a password to a PDF with a server-side encryption service. The interface is complete; this deployment has not configured one.",
    intro:
      "Encrypt a PDF so it needs a password to open. The interface below is finished and honest about the one thing it cannot do yet: the encryption service is not configured.",
    icon: "Lock",
    keywords: ["password protect", "encrypt pdf", "secure pdf", "add password", "restrict pdf"],
    route: "/tools/pdf/protect",
    processing: "server",
    status: "setup-required",
    addedOn: "2026-02-20",
    actionLabel: "Encrypt PDF",
    setupNote:
      "Requires a server-side PDF encryption library that this deployment has not configured.\n\nAdd to your environment:\n  PDF_ENCRYPTION_API_URL=https://…\n  PDF_ENCRYPTION_API_KEY=…\n\nThen implement POST /api/tools/pdf/encrypt and POST /api/tools/pdf/decrypt (see /api/tools for the Zod + rate-limit pattern) and flip this tool's status to \"stable\".\n\nWhy: pdf-lib cannot write PDF encryption (it reads an encrypted file's structure but never emits the /Encrypt dictionary), and Web Crypto's AES is not the RC4 or AES-256 scheme a PDF reader expects. Encrypting a PDF correctly needs a native library such as qpdf, which cannot run in a browser tab.",
    features: [
      "Pick a document password and optional owner password",
      "Choose 128-bit or 256-bit AES, and whether printing and copying are allowed",
      "Validation and confirmation of the password before anything is sent",
      "Posts to a server route and downloads the encrypted result",
      "Says up front that the service is not configured instead of pretending to work",
    ],
    howItWorks: [
      "Drop in the PDF you want to protect.",
      "Set the passwords and the permission flags.",
      "Press Encrypt PDF (or Ctrl + Enter) — this needs the server service.",
      "Download the encrypted document.",
    ],
    faq: [
      {
        question: "Does this work right now?",
        answer:
          "No. The interface ships complete, but encrypting a PDF requires a native library on a server, and this deployment has not configured one. Pressing the button tells you exactly which environment variable is missing rather than showing a fake success.",
      },
      {
        question: "What would the operator need to set up?",
        answer:
          "A PDF encryption API reachable at PDF_ENCRYPTION_API_URL with a key in PDF_ENCRYPTION_API_KEY, plus a POST /api/tools/pdf/encrypt route that validates the body with Zod, rate-limits it, calls the service and streams the encrypted PDF back.",
      },
      {
        question: "Why can't this just run in the browser?",
        answer:
          "A PDF reader expects RC4 or AES-256 in the specific key derivation the PDF spec defines, applied to every string and stream in the file. Web Crypto has the primitives but not the PDF envelope, and pdf-lib has no encrypt method at all.",
      },
      {
        question: "What is the difference between a document and an owner password?",
        answer:
          "The document password is needed to open the file. The owner password opens it and controls the permission flags, so the owner can lift restrictions the document password imposed. The form here asks for both.",
      },
    ],
    related: ["pdf-remove-password", "pdf-metadata", "pdf-merge"],
  },

  {
    id: "pdf-remove-password",
    name: "Remove PDF Password",
    slug: "remove-password",
    category: "pdf",
    description:
      "Decrypt a password-protected PDF with a server-side service. The interface is complete; this deployment has not configured one.",
    intro:
      "Open a PDF you have the password for. The interface is finished; the decryption service it needs has not been configured on this deployment.",
    icon: "Unlock",
    keywords: ["remove pdf password", "decrypt pdf", "unlock pdf", "pdf password remover"],
    route: "/tools/pdf/remove-password",
    processing: "server",
    status: "setup-required",
    addedOn: "2026-02-20",
    actionLabel: "Remove password",
    setupNote:
      "Requires a server-side PDF decryption library that this deployment has not configured.\n\nAdd to your environment:\n  PDF_ENCRYPTION_API_URL=https://…\n  PDF_ENCRYPTION_API_KEY=…\n\nThen implement POST /api/tools/pdf/decrypt (and its encrypt counterpart POST /api/tools/pdf/encrypt) — see /api/tools for the Zod + rate-limit pattern — and flip this tool's status to \"stable\".\n\nWhy: pdf-lib reads an encrypted document's structure but cannot decrypt its strings and streams, so there is no browser-only path to a decrypted file.",
    features: [
      "Detects the encryption state of the dropped file before you do anything",
      "Password field with an explicit reveal toggle, never logged or stored",
      "Optional owner-password field for files where permissions apply",
      "Posts the file and password to a server route and downloads the result",
      "Says up front that the service is not configured instead of faking a decrypted file",
    ],
    howItWorks: [
      "Drop in the password-protected PDF.",
      "Enter the password.",
      "Press Remove password (or Ctrl + Enter) — this needs the server service.",
      "Download the decrypted document.",
    ],
    faq: [
      {
        question: "Does this work right now?",
        answer:
          "No. The interface ships complete, but decrypting a PDF needs a native library on a server and this deployment has not configured one. The button reports the missing configuration instead of pretending to succeed.",
      },
      {
        question: "Is the password sent anywhere?",
        answer:
          "When the service is configured, the file and the password are posted to your own server route, forwarded to the configured encryption API, and neither is written to a database. The temporary copy is deleted when the request ends.",
      },
      {
        question: "Can this crack an unknown password?",
        answer:
          "No, and no legitimate tool should. Decryption needs the correct password. What the service does is apply the PDF's own key derivation to the file, which a browser cannot do.",
      },
    ],
    related: ["pdf-protect", "pdf-metadata", "pdf-merge"],
  },
];
