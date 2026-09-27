import type { Tool } from "../types";

/**
 * The AI category.
 *
 * Every entry here is `status: "setup-required"` on purpose. None of these
 * tools can produce a result until an operator sets `AI_API_KEY` on the
 * deployment, and the house rule is that we do not ship a tool that pretends to
 * work. When a provider is configured the workspaces check
 * `GET /api/ai/status` and render the real interface; until then the page shows
 * the exact variables to set.
 *
 * To promote one (or all) of them: set the variables, verify the tool, then
 * change `status` to "stable" here. Nothing else needs to change.
 */

const PROVIDER_SETUP_NOTE = `Requires an AI provider. Add to your environment and restart:

  AI_API_KEY=sk-…
  AI_BASE_URL=https://api.openai.com/v1   # any OpenAI-compatible endpoint
  AI_MODEL=gpt-4o-mini

Then set this tool's status to "stable" in lib/tools/definitions/ai.ts.`;

const IMAGE_SETUP_NOTE = `Requires an AI provider with an image model. Add to your environment and restart:

  AI_API_KEY=sk-…
  AI_BASE_URL=https://api.openai.com/v1   # any OpenAI-compatible endpoint
  AI_MODEL=gpt-4o-mini
  AI_IMAGE_MODEL=gpt-image-1              # or dall-e-3, or a Together flux id

Then set this tool's status to "stable" in lib/tools/definitions/ai.ts.`;

/** Shared, honest privacy answer. These tools all send data to a third party. */
const THIRD_PARTY_ANSWER =
  "Your input is sent to whichever AI provider the operator of this deployment configured — we do not run a model ourselves, and we never see the key. The provider may keep the request according to its own policy, so treat anything you paste as leaving your device. Nothing is written to our database and we do not log prompts.";

const QUALITY_ANSWER =
  "No. Language models produce the most likely continuation of your text, not verified fact, and they get things wrong in ways that read as confident. Check names, numbers, citations, legal and medical statements, and anything you are about to publish.";

const COST_ANSWER =
  "Every run costs the operator real money at the provider, billed per token or per image. We meter each request on the server, but we cannot promise this is free forever. If you are self-hosting, set up your own spending cap with the provider.";

export const AI_TOOLS: readonly Tool[] = [
  {
    id: "ai-text-generator",
    name: "AI Text Generator",
    slug: "text-generator",
    category: "ai",
    description:
      "Turn a one-line brief into finished copy. Pick the tone, length and format, and a language model writes the first draft for you.",
    intro:
      "Give it a brief and it gives you a draft you can edit. Choose the tone, length and format first so the first version is close to the one you wanted.",
    icon: "Sparkles",
    keywords: ["write", "copywriting", "draft", "content generator", "copy", "blog intro"],
    route: "/tools/ai/text-generator",
    processing: "ai",
    status: "setup-required",
    popular: true,
    addedOn: "2026-01-10",
    actionLabel: "Write",
    setupNote: PROVIDER_SETUP_NOTE,
    features: [
      "Works from a brief as short as one sentence, or from a longer outline you paste in",
      "Ten tones from neutral to playful, and a creativity slider that controls how far it strays from your words",
      "Output formats include plain text, markdown, a bullet list, short paragraphs, a business email, a blog post and an SEO title plus meta description",
      "Aim it at a specific audience and require keywords it has to work in naturally",
      "Copy the result or download it as a .md or .txt file",
      "Nothing is saved: the draft lives in the page until you reload",
    ],
    howItWorks: [
      "You describe what you need — the product, the reader, the job the copy has to do.",
      "You pick a tone, a length, a format and, if it matters, an audience or a list of keywords.",
      "Your brief is sent to the configured provider through our server, which holds the API key so the browser never sees it.",
      "The draft comes back as plain text you can copy or download, then edit before you use it anywhere.",
    ],
    faq: [
      {
        question: "Is the text written by a human?",
        answer:
          "No. It is written by a language model — most likely GPT-4o-mini or whatever AI_MODEL points at. It is a machine producing plausible text, not a writer with opinions or sources.",
      },
      {
        question: "Will it get facts wrong?",
        answer:
          "Yes, sometimes, and it will not flag it when it does. Statistics, dates, citations and legal or medical claims are the usual casualties. It is told to preserve names and numbers from your brief, but treat any figure it introduces as fiction until you check it.",
      },
      {
        question: "Where does my brief go?",
        answer: THIRD_PARTY_ANSWER,
      },
      {
        question: "Does this cost anything?",
        answer: COST_ANSWER,
      },
      {
        question: "Why is this marked setup required?",
        answer:
          "Because no AI provider is configured on this deployment. The interface below is complete, but the request has nowhere to go until an operator sets AI_API_KEY, AI_BASE_URL and AI_MODEL. We would rather say that than show a button that silently fails.",
      },
    ],
    related: ["ai-rewriter", "ai-summarizer", "ai-prompt-generator", "ai-translator"],
  },
  {
    id: "ai-rewriter",
    name: "AI Rewriter",
    slug: "rewriter",
    category: "ai",
    description:
      "Rewrite a paragraph, an email or an article in a new tone without losing the facts. Keep the meaning, change the voice.",
    intro:
      "Paste anything that reads wrong and rewrite it in the voice you actually want — while keeping every fact, name and number intact.",
    icon: "PenLine",
    keywords: ["rewrite", "paraphrase", "rephrase", "edit", "tone", "proofread"],
    route: "/tools/ai/rewriter",
    processing: "ai",
    status: "setup-required",
    popular: true,
    addedOn: "2026-01-10",
    actionLabel: "Rewrite",
    setupNote: PROVIDER_SETUP_NOTE,
    features: [
      "Ten target tones, from formal and technical to casual and playful",
      "A length control that tightens or expands without padding the result",
      "Keep-structure mode preserves your headings, sectioning and order",
      "A creativity slider for edits that should stay close to the original or be allowed to run",
      "Told explicitly not to change facts, names, numbers or links",
      "Download the rewrite as .txt, or send it straight to the Summarizer",
    ],
    howItWorks: [
      "Paste the text you want rewritten — an email, a paragraph, a whole article.",
      "Choose a tone, a length and how creative the edit may be.",
      "The text goes to the configured provider via our server, which keeps the API key out of the browser.",
      "The rewrite comes back as plain text for you to keep, edit or discard.",
    ],
    faq: [
      {
        question: "Will rewriting change what my text says?",
        answer:
          "It is instructed to keep every factual claim, name, number and link, but a model is not a proofreader with a diff. Read the result against the original before you publish it, especially if precision matters.",
      },
      {
        question: "Can I use this to disguise copied work?",
        answer:
          "Technically, yes, and that is the main thing to be careful about. Rewriting someone else's article does not make it yours, and most search engines can spot paraphrased text. It is a tool for making your own writing better, not for taking credit.",
      },
      { question: "Where does my text go?", answer: THIRD_PARTY_ANSWER },
      { question: "Does it cost anything?", answer: COST_ANSWER },
      {
        question: "How long can the input be?",
        answer:
          "Up to 32,000 characters, which is roughly 5,000 words. Longer input gets truncated by most models' context windows anyway, so we cap it rather than let the request fail upstream.",
      },
    ],
    related: ["ai-summarizer", "ai-text-generator", "ai-translator", "ai-prompt-generator"],
  },
  {
    id: "ai-summarizer",
    name: "AI Summarizer",
    slug: "summarizer",
    category: "ai",
    description:
      "Condense a long article, meeting note or report into the points that matter, with the numbers and names left intact.",
    intro:
      "Paste a long document and get the version that keeps the facts. Choose a length, pick a format, and add a note about who the summary is for.",
    icon: "ScrollText",
    keywords: ["summarize", "summarise", "tl;dr", "condense", "shorten", "abstract"],
    route: "/tools/ai/summarizer",
    processing: "ai",
    status: "setup-required",
    popular: true,
    addedOn: "2026-01-10",
    actionLabel: "Summarise",
    setupNote: PROVIDER_SETUP_NOTE,
    features: [
      "Five length settings, from noticeably shorter to thoroughly detailed",
      "Bullet lists, short paragraphs or continuous prose",
      "A purpose field — say who the summary is for and the model adjusts what it keeps",
      "Keep-structure mode mirrors the original's headings and order",
      "Instructed to preserve every number, name, date and conclusion, and to add nothing of its own",
      "Copy it or download the summary as a .txt file",
    ],
    howItWorks: [
      "Paste the article, transcript, report or meeting notes.",
      "Set the length and the format, and optionally say what the summary is for.",
      "The text is sent to the configured provider through our server, which holds the API key.",
      "The summary comes back as plain text that you can copy or download.",
    ],
    faq: [
      {
        question: "Does the summary leave out anything important?",
        answer:
          "It can, and it will not tell you what it dropped. A summary is a lossy operation by definition. If the detail matters — a contract term, a dosage, a deadline — read the source. The model is told to keep numbers, names and conclusions, which helps, but it is not a guarantee.",
      },
      {
        question: "Why did it leave out the part I cared about?",
        answer:
          "Tell it in the purpose field. Writing 'for a board member deciding on budget' or 'for a study revision on photosynthesis' shifts what it treats as load-bearing. If that is still not enough, summarise a smaller section rather than the whole document.",
      },
      { question: "Where does my document go?", answer: THIRD_PARTY_ANSWER },
      { question: "Does it cost anything?", answer: COST_ANSWER },
      {
        question: "Can it summarise a scanned PDF?",
        answer:
          "No. This tool works on text you paste. A scan has no text layer to read, so the empty result would be honest but useless — use the OCR-capable tool in the PDF category for that, then paste the text here.",
      },
    ],
    related: ["ai-rewriter", "ai-text-generator", "ai-pdf-chat", "ai-translator"],
  },
  {
    id: "ai-translator",
    name: "AI Translator",
    slug: "translator",
    category: "ai",
    description:
      "Translate text into another language with the register preserved — formal stays formal, names, code and links are left alone.",
    intro:
      "Translate prose, an email or a UI string and keep the register intact. Proper nouns, code identifiers and placeholders are deliberately left untouched.",
    icon: "Languages",
    keywords: ["translate", "translation", "language", "localise", "localize", "idioma"],
    route: "/tools/ai/translator",
    processing: "ai",
    status: "setup-required",
    addedOn: "2026-01-17",
    actionLabel: "Translate",
    setupNote: PROVIDER_SETUP_NOTE,
    features: [
      "Any target language by name — no dropdown to fight with",
      "Register control: keep the source tone, or move it to formal or casual",
      "Output as plain text, short paragraphs or markdown so structure survives",
      "Keep-structure mode preserves your paragraphing and headings",
      "Placeholders such as {name} and code identifiers are explicitly protected",
      "Untranslatable lines keep the original with a short translator's note",
    ],
    howItWorks: [
      "Paste the text and type the language you want it in.",
      "Choose whether to keep the source register or shift it, and pick an output format.",
      "The text is sent to the configured provider via our server, which holds the API key.",
      "The translation comes back as plain text you can copy or download.",
    ],
    faq: [
      {
        question: "Is this as good as a professional translator?",
        answer:
          "For everyday prose, emails and UI copy, usually. For a contract, a medical leaflet, a patent or anything legally binding, no. Language models are fluent and confident and occasionally wrong about a term of art, and they cannot be held responsible. Get a human to check anything with consequences.",
      },
      {
        question: "Why are some words left in English?",
        answer:
          "On purpose. Brand names, product names, code identifiers, file names, URLs and placeholders like {count} are kept as they are, because translating them breaks whatever consumes them. It will tell you when it keeps something and why.",
      },
      { question: "Which languages are supported?", answer:
        "Whatever the configured model handles — realistically a hundred or more, and it is strongest in the major European and world languages. It will attempt anything you ask for, so ask for a language you actually need it to be good at." },
      { question: "Where does my text go?", answer: THIRD_PARTY_ANSWER },
      { question: "Does it cost anything?", answer: COST_ANSWER },
    ],
    related: ["ai-rewriter", "ai-summarizer", "ai-text-generator", "ai-prompt-generator"],
  },
  {
    id: "ai-prompt-generator",
    name: "AI Prompt Generator",
    slug: "prompt-generator",
    category: "ai",
    description:
      "Turn a vague idea into a reusable prompt: image prompts for a diffusion model, system prompts for an agent, or text prompts with clear slots.",
    intro:
      "Describe the job, get a prompt you can paste and reuse. Written for image models, for agents with an output contract, or for text generation with marked variable slots.",
    icon: "MessageSquareText",
    keywords: ["prompt", "prompt engineering", "system prompt", "image prompt", "instructions"],
    route: "/tools/ai/prompt-generator",
    processing: "ai",
    status: "setup-required",
    addedOn: "2026-01-17",
    actionLabel: "Generate prompt",
    setupNote: PROVIDER_SETUP_NOTE,
    features: [
      "Three output shapes: an image prompt, a reusable text prompt with [VARIABLE] slots, or an agent system prompt",
      "Detail control from a one-line prompt to a fully specified brief",
      "An audience field, for prompts aimed at a particular reader or model",
      "A creativity slider for a conventional prompt or an inventive one",
      "Written as a copy-paste block with no surrounding commentary",
      "Download the prompt as a .md file and drop it into your own project",
    ],
    howItWorks: [
      "Describe the job you want a prompt for in a sentence or two.",
      "Choose whether you want an image prompt, a text prompt or an agent instruction, and how detailed it should be.",
      "The description is sent to the configured provider through our server, which holds the API key.",
      "The prompt comes back as plain text, ready to copy into whatever tool you are driving.",
    ],
    faq: [
      {
        question: "Is there a secret formula this uses?",
        answer:
          "There are conventions — role, context, task, constraints, output format — and they genuinely help. But the value is in writing down what you actually want and what 'done' looks like, not in magic words. Treat anything claiming otherwise with suspicion.",
      },
      {
        question: "Will the prompt work on any model?",
        answer:
          "The structure transfers well between capable models; the specifics do not. Some models need the role stated explicitly, others ignore it. If a generated prompt underperforms, the fix is usually more constraint and a clearer output format, which you can add by hand.",
      },
      { question: "Where does my description go?", answer: THIRD_PARTY_ANSWER },
      { question: "Does it cost anything?", answer: COST_ANSWER },
      {
        question: "Why is this marked setup required?",
        answer:
          "No AI provider is configured on this deployment, so there is nothing to send the description to. The page lists the exact environment variables an operator needs to set.",
      },
    ],
    related: ["ai-text-generator", "ai-rewriter", "ai-image-generator", "ai-summarizer"],
  },
  {
    id: "ai-image-generator",
    name: "AI Image Generator",
    slug: "image-generator",
    category: "ai",
    description:
      "Generate an image from a description, with control over size, visual style and how much freedom the model has.",
    intro:
      "Describe a picture and get one back. Choose the canvas size, the visual style and how inventive the model may be, then download the result.",
    icon: "WandSparkles",
    keywords: ["generate image", "text to image", "ai art", "illustration", "diffusion", "create image"],
    route: "/tools/ai/image-generator",
    processing: "ai",
    status: "setup-required",
    popular: true,
    addedOn: "2026-01-24",
    actionLabel: "Generate image",
    setupNote: IMAGE_SETUP_NOTE,
    features: [
      "Six canvas sizes, from 256×256 up to 1792×1024",
      "Eleven visual styles — photographic, flat vector, 3D render, watercolour, line art and more",
      "A creativity slider from literal to wide open",
      "Detail level control for the amount of visible detail",
      "Preview the result at full size and download it as a PNG",
      "Shows the provider's rewritten prompt when it sends one, so you can see what it actually drew",
    ],
    howItWorks: [
      "Describe the image you want in as much or as little detail as you like.",
      "Pick a size, a visual style, a detail level and how creative the model may be.",
      "Your description is sent to the configured image model through our server, which holds the API key.",
      "The image comes back as a PNG you can preview and download.",
    ],
    faq: [
      {
        question: "Is it free?",
        answer:
          "Not necessarily. Image models are billed per generated image by every major provider, and a failed generation is usually still billed. We meter requests but cannot promise this stays free to you.",
      },
      {
        question: "Why did the picture not look like my description?",
        answer:
          "Image models respond to concrete visual language, not concepts. 'A mugshot of a determined shopkeeper at dawn' produces a different result from 'close-up portrait of a shopkeeper, early morning light, neutral expression'. Describe light, framing, material and mood rather than narrative. The provider's rewritten prompt, when it sends one, shows what it actually used.",
      },
      {
        question: "Can I use the result commercially?",
        answer:
          "That depends on your provider's terms, not on us. Most commercial providers grant you rights to the output, but some restrict it, and all of them will refuse to reproduce brands, living people and copyrighted characters. Read the terms of whatever model is configured before you ship something you made here.",
      },
      { question: "Where does my prompt go?", answer: THIRD_PARTY_ANSWER },
      { question: "Why does it need AI_IMAGE_MODEL as well as AI_API_KEY?",
        answer:
          "Because chat and image models are separate products with separate ids. AI_MODEL handles the text tools; AI_IMAGE_MODEL names the image model this one calls. Without it the route answers with a 501 that tells you exactly which variable to set." },
    ],
    related: ["ai-image-enhancer", "ai-background-generator", "ai-image-analyzer", "ai-prompt-generator"],
  },
  {
    id: "ai-image-enhancer",
    name: "AI Image Enhancer",
    slug: "image-enhancer",
    category: "ai",
    description:
      "Send a soft, noisy or low-quality photo to an image model and get back a cleaner, sharper version of the same picture.",
    intro:
      "A soft, noisy or badly compressed photo goes out to an image model and comes back sharper and cleaner — the same picture, not a different one.",
    icon: "ImagePlus",
    keywords: ["enhance", "improve quality", "denoise", "sharpen", "restore", "upscale quality"],
    route: "/tools/ai/image-enhancer",
    processing: "ai",
    status: "setup-required",
    addedOn: "2026-01-24",
    actionLabel: "Enhance image",
    setupNote: IMAGE_SETUP_NOTE,
    features: [
      "Four strength settings, from a subtle touch-up to the strongest change the model will make",
      "Free-text instructions, so you can ask for sharpening, denoising or a colour repair specifically",
      "The original stays on screen next to the result so you can compare",
      "Download the enhanced PNG and keep the original file untouched",
      "PNG, JPEG, WebP and GIF uploads up to 8 MB",
      "Told explicitly that the subject, framing and colours must not change",
    ],
    howItWorks: [
      "Drop in the image you want improved.",
      "Choose how far to push the change, and optionally describe what is wrong with it.",
      "The image is sent to the configured image model through our server, which holds the API key.",
      "The enhanced version comes back as a PNG you can compare and download.",
    ],
    faq: [
      {
        question: "Is this a real AI upscaler?",
        answer:
          "It depends entirely on the model configured. Some image models genuinely reconstruct detail; others sharpen edges and leave the underlying resolution alone. If you want more pixels rather than better-looking pixels, use the Image Upscaler instead.",
      },
      {
        question: "Will it change my photo?",
        answer:
          "It is instructed to keep the subject, framing and colours identical, and the original is shown beside the result so you can check. Still, image models hallucinate. Look at faces, text in the image and fine patterns before you trust a heavily enhanced result.",
      },
      { question: "What happens to my photo?", answer: THIRD_PARTY_ANSWER },
      {
        question: "Why is the file limited to 8 MB?",
        answer:
          "The image is base64-encoded into a JSON request, which inflates it by about a third, and providers cap uploads well below browser file sizes. Rather than let a 40 MB photo fail upstream with an opaque error, the limit is checked here and you are told straight away.",
      },
      { question: "Does it cost anything?", answer: COST_ANSWER },
    ],
    related: ["ai-image-upscaler", "ai-image-generator", "ai-background-remover", "ai-image-analyzer"],
  },
  {
    id: "ai-image-upscaler",
    name: "AI Image Upscaler",
    slug: "image-upscaler",
    category: "ai",
    description:
      "Send a small image to an image model and get a larger one back, with the extra detail invented to match the original.",
    intro:
      "Make a small image bigger. The model adds the detail that a larger version would plausibly have had, and you choose how far to push it.",
    icon: "ZoomIn",
    keywords: ["upscale", "enlarge", "increase resolution", "higher resolution", "make bigger", "4x"],
    route: "/tools/ai/image-upscaler",
    processing: "ai",
    status: "setup-required",
    addedOn: "2026-01-24",
    actionLabel: "Upscale image",
    setupNote: IMAGE_SETUP_NOTE,
    features: [
      "Target canvas sizes from 512×512 up to 1792×1024",
      "Four strength settings, from a modest enlargement to the most aggressive one",
      "Free-text instructions for the specific problem — a soft face, a blurry logo, a small scan",
      "The original is shown beside the result so the difference is obvious",
      "Download the upscaled PNG; the file you uploaded is never modified",
      "Honest about the limit: generated detail is plausible, not recovered",
    ],
    howItWorks: [
      "Drop in the small image.",
      "Choose a target size, how hard the model should work, and optionally what to focus on.",
      "The image is sent to the configured image model through our server, which holds the API key.",
      "The larger version comes back as a PNG you can compare and download.",
    ],
    faq: [
      {
        question: "Is the extra detail real?",
        answer:
          "No, and this matters. An upscaler cannot recover detail that was never captured — it invents detail that looks right. Faces come out plausible rather than true, and text in a photo usually gets worse. For documents and screenshots, use a real resolution tool; for a photo you are about to print small, this is genuinely useful.",
      },
      {
        question: "How large can the result be?",
        answer:
          "Up to 1792×1024, which is a practical limit set by the size parameters the major providers accept. A 4× enlargement of a 12-megapixel photo is not available here.",
      },
      { question: "What happens to my photo?", answer: THIRD_PARTY_ANSWER },
      { question: "Does it cost anything?", answer: COST_ANSWER },
      {
        question: "Is my original changed?",
        answer:
          "No. The file on your device is only read. The enhanced result is a new PNG built in memory, and the original stays exactly as it was.",
      },
    ],
    related: ["ai-image-enhancer", "ai-image-generator", "ai-image-analyzer", "ai-background-remover"],
  },
  {
    id: "ai-background-remover",
    name: "AI Background Remover",
    slug: "background-remover",
    category: "ai",
    description:
      "Ask an image model to strip the background from a photo, keeping hair and fine edges, then download the cut-out as a PNG.",
    intro:
      "Send a photo to an image model and ask it to remove everything but the subject. Quality depends on the model — read the FAQ before you rely on it for a batch.",
    icon: "ScanEye",
    keywords: ["remove background", "cut out", "transparent background", "background removal", "isolate subject"],
    route: "/tools/ai/background-remover",
    processing: "ai",
    status: "setup-required",
    addedOn: "2026-01-31",
    actionLabel: "Remove background",
    setupNote: IMAGE_SETUP_NOTE,
    features: [
      "Keep the cut-out transparent, or replace the background with solid white or black",
      "Edge quality control — ask the model to work harder on hair and fine detail",
      "Free-text instructions when a specific element must stay or go",
      "Preview on a checkerboard so a transparent edge is easy to judge",
      "Download the result as a PNG",
      "The original is shown beside the cut-out for comparison",
    ],
    howItWorks: [
      "Drop in the photo with the background you want gone.",
      "Choose what should replace the background, how hard to work on the edges, and any specific instruction.",
      "The image is sent to the configured image model through our server, which holds the API key.",
      "The cut-out comes back as a PNG you can check on a checkerboard and download.",
    ],
    faq: [
      {
        question: "How good is the cut-out?",
        answer:
          "It depends entirely on the model configured, and this is the most important thing to know about this tool. General image models regenerate an image rather than computing a matte, so edges can be soft, haloes can appear and fine hair can turn into mush. A provider with a dedicated segmentation model will do much better. Try one image, look at the edges, and only then trust it with a batch.",
      },
      {
        question: "Can it remove a logo or a person from a photo?",
        answer:
          "The tool sends the whole image to the model with an instruction, so in principle yes. In practice providers refuse requests to remove a person or to manipulate a real individual's likeness, and the request comes back as a refusal. That is a provider policy, not a bug here.",
      },
      { question: "What happens to my photo?", answer: THIRD_PARTY_ANSWER },
      { question: "Does it cost anything?", answer: COST_ANSWER },
      {
        question: "Is the result a real alpha channel?",
        answer:
          "Yes — the result is delivered as a PNG with transparency, which is why you can see the checkerboard through it. If your provider returns JPEG instead, the tool will not pretend the background is gone; it will fail rather than hand you a white rectangle.",
      },
    ],
    related: ["ai-background-generator", "ai-image-enhancer", "ai-image-upscaler", "ai-image-analyzer"],
  },
  {
    id: "ai-background-generator",
    name: "AI Background Generator",
    slug: "background-generator",
    category: "ai",
    description:
      "Generate a background plate — a studio backdrop, an abstract gradient, a pattern or a scene — with no subject in it.",
    intro:
      "Generate a background to put something in front of. Ask for a studio sweep, a gradient, a pattern or a scene, and keep the middle clear.",
    icon: "Image",
    keywords: ["background", "backdrop", "wallpaper", "pattern", "gradient", "studio"],
    route: "/tools/ai/background-generator",
    processing: "ai",
    status: "setup-required",
    addedOn: "2026-01-31",
    actionLabel: "Generate background",
    setupNote: IMAGE_SETUP_NOTE,
    features: [
      "Six canvas sizes, including the portrait and landscape ratios you need for a banner",
      "Eleven background styles — studio backdrop, abstract gradient, solid colour, pattern, scene and more",
      "Detail level control, so a flat colour stays flat and a scene gets depth",
      "A creativity slider for how far the model strays from your description",
      "Preview at full size and download the PNG",
      "Told to leave the middle clear and to put no text, people or objects in the frame",
    ],
    howItWorks: [
      "Describe the background you want, and what is going to sit in front of it.",
      "Choose a size, a background style, a detail level and how inventive the model may be.",
      "Your description is sent to the configured image model through our server, which holds the API key.",
      "The background comes back as a PNG you can preview and download.",
    ],
    faq: [
      {
        question: "Will it leave room for my subject?",
        answer:
          "It is instructed to produce a background plate with space in the middle, but there is no guarantee. Say what the background is for — 'empty centre for a product cut-out' or 'clear area in the lower third for a caption' — and check the result before you build on it.",
      },
      {
        question: "Can I use it as a seamless tiling pattern?",
        answer:
          "Ask for one and the model will produce something pattern-like, but it will not tile. Genuine seamlessness has to come from a pattern tool or a texture library, not from a generative model.",
      },
      { question: "Where does my prompt go?", answer: THIRD_PARTY_ANSWER },
      { question: "Does it cost anything?", answer: COST_ANSWER },
      {
        question: "Can it make a background with text on it?",
        answer:
          "Almost certainly not legibly. Image models render lettering badly, and this tool is explicitly told not to draw text. Add any wording in your own design tool afterwards.",
      },
    ],
    related: ["ai-image-generator", "ai-background-remover", "ai-image-enhancer", "ai-image-analyzer"],
  },
  {
    id: "ai-pdf-chat",
    name: "AI PDF Chat",
    slug: "pdf-chat",
    category: "ai",
    description:
      "Ask questions about a PDF and get answers grounded in its text. The document is read in your browser and the context sent is always shown.",
    intro:
      "Drop in a PDF, then ask about it. The text is extracted in your browser so the file itself stays on your device, and you can always see exactly how much of it went to the model.",
    icon: "Quote",
    keywords: ["pdf chat", "ask pdf", "question a document", "pdf qa", "chat with pdf", "summarise pdf"],
    route: "/tools/ai/pdf-chat",
    processing: "ai",
    status: "setup-required",
    addedOn: "2026-02-07",
    actionLabel: "Ask question",
    setupNote: PROVIDER_SETUP_NOTE,
    features: [
      "The PDF is read in your browser, so the file itself is never uploaded",
      "Shows the exact character count of context sent, and says plainly when a document was truncated",
      "Follow-up questions keep the earlier turns, so you can drill into the same document",
      "The model is instructed to answer only from the text and to say when the answer is not there",
      "Warns before you ask when a document is larger than most models can read in one go",
      "Copy any answer, or download the whole conversation as a .md file",
    ],
    howItWorks: [
      "Drop in a PDF. Its text layer is extracted locally with pdf.js — the file never leaves your device.",
      "You see the character count and a warning if the document is too long to send whole.",
      "Your question, plus as much of the document as fits, goes to the configured provider through our server.",
      "The answer comes back with the model named, so you always know what wrote it.",
    ],
    faq: [
      {
        question: "Does my PDF get uploaded?",
        answer:
          "Not on the normal path. The text is extracted in your browser and only that text is sent. If in-browser extraction fails — some scanned PDFs have no text layer to read — the page offers to send the file to our server instead, and tells you clearly when you take that option.",
      },
      {
        question: "Why does it say my document was truncated?",
        answer:
          "Because it was. Only the first 24,000 characters of the extracted text are sent, which keeps the request inside a typical context window and the cost bounded. The answer may then be missing something in the part that was cut, and the model is told to say so when that happens.",
      },
      {
        question: "Can it read a scanned document?",
        answer:
          "No. A scan is an image of text with no text layer underneath, so there is nothing to extract and no OCR step here. The page will tell you the PDF has no extractable text rather than pretending to have read it. Run it through an OCR tool first, then ask about the resulting text.",
      },
      { question: "Can it give me a wrong answer?", answer: QUALITY_ANSWER },
      { question: "Does it cost anything?", answer: COST_ANSWER },
    ],
    related: ["ai-summarizer", "ai-text-generator", "ai-image-analyzer", "ai-translator"],
  },
  {
    id: "ai-image-analyzer",
    name: "AI Image Analyzer",
    slug: "image-analyzer",
    category: "ai",
    description:
      "Get a description, alt text or a text transcription out of an image using a vision model, and download the readout.",
    intro:
      "A vision model looks at your image and writes down what is in it — a description, accessibility alt text, a text transcription or a list of objects.",
    icon: "ScanEye",
    keywords: ["analyze image", "describe image", "alt text", "ocr", "read image", "accessibility"],
    route: "/tools/ai/image-analyzer",
    processing: "ai",
    status: "setup-required",
    addedOn: "2026-02-07",
    actionLabel: "Analyse image",
    setupNote: PROVIDER_SETUP_NOTE,
    features: [
      "Six readouts: a short description, a detailed one, accessibility alt text, a text transcription, an object list or labelled fields",
      "Detail level control, which changes how much the model looks for",
      "An audience field, so alt text can be written for a screen reader rather than a colleague",
      "Free-text instructions to ask something specific instead",
      "Key-value readouts are parsed into a labelled list for you — the raw text is always shown too",
      "Copy the readout or download it as a .txt file",
    ],
    howItWorks: [
      "Drop in the image you want read.",
      "Choose what you want back — a description, alt text, a transcription — and optionally ask something specific.",
      "The image is sent to the configured vision model through our server, which holds the API key.",
      "The readout comes back as plain text you can copy or download.",
    ],
    faq: [
      {
        question: "Is the transcription accurate enough to rely on?",
        answer:
          "For printed, high-contrast text, usually. For a screenshot with a small font, a photograph of a screen, handwriting, or a skewed page, expect mistakes — and expect it to be confidently wrong rather than to hedge. Always compare a transcription against the image before you use it for anything that matters.",
      },
      {
        question: "Is the alt text good enough to ship?",
        answer:
          "It is a strong starting point, and for an image that is obviously a product shot or a landscape it will be close. It will not know your context — who the person is, why the chart matters, what the reader already knows. Alt text is a judgement, and a model can only get you the first draft of it.",
      },
      { question: "What happens to my image?", answer: THIRD_PARTY_ANSWER },
      {
        question: "Does it identify people?",
        answer:
          "No, and that is deliberate. Vision models are instructed by their providers not to name or identify people, and we do not try to work around it. It will describe an adult, a child or a crowd; it will not tell you who they are.",
      },
      { question: "Does it cost anything?", answer: COST_ANSWER },
    ],
    related: ["ai-background-remover", "ai-image-enhancer", "ai-image-generator", "ai-pdf-chat"],
  },
];
