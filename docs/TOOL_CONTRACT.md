# Tool implementation contract

Read this before writing any tool. Everything here is enforced by TypeScript.

## Repository

`E:\Tools` — Next.js 16 App Router, TypeScript strict, Tailwind CSS v4, `pnpm`-less npm.

- Path alias: `@/*` → repo root.
- **Never** add a dependency without asking. Installed runtime deps: `next`, `react`,
  `react-dom`, `lucide-react`, `sonner`, `zod`, `pdf-lib`, `pdfjs-dist`, `jszip`, `qrcode`,
  `gifenc`, `@noble/hashes`, `@breezystack/lamejs`, `clsx`, `tailwind-merge`.
- Server Components by default. Add `"use client"` only where interaction is required.
- Never use `any`. Never use `@ts-ignore`. If a type fights you, narrow it properly.

## Colour tokens (never raw hex in components)

Use the CSS variables. Dark is the default; light mode swaps the same variables.

| Token | Value (dark) |
| --- | --- |
| `var(--surface-canvas)` | `#050505` page background |
| `var(--surface-card)` | `#0D0D0D` card |
| `var(--surface-card-2)` | `#121212` inset / secondary card |
| `var(--surface-line)` | `#242424` border |
| `var(--surface-line-strong)` | `#333333` emphasised border |
| `var(--text-ink)` | `#FFFFFF` primary text |
| `var(--text-muted)` | `#8A8A8A` secondary text |

Brand red: Tailwind `brand-*` (`text-brand-500`, `bg-brand-500`, `border-brand-500/40`, …).
`#FF3B30` is `--color-brand-500`.

Never use gradients for decoration, glassmorphism, or drop shadows bigger than
`shadow-xl`. Card radius is `rounded-[14px]`; controls are `rounded-[10px]`.

## File you own: `lib/tools/definitions/<category>.ts`

```ts
import type { Tool } from "../types";

export const IMAGE_TOOLS: readonly Tool[] = [
  {
    id: "image-compressor",              // unique kebab-case, prefixed with category
    name: "Image Compressor",
    slug: "compressor",                  // unique within the category
    category: "image",
    description: "…",                    // <= 160 chars, no trailing period issues
    intro: "…",                          // 1–2 sentences
    icon: "ImageDown",                   // MUST exist in ToolIconName union
    keywords: ["shrink", "optimise", "reduce size"],
    route: "/tools/image/compressor",    // /tools/<category>/<slug>
    processing: "local",                 // "local" | "server" | "ai"
    status: "stable",                    // "stable" | "beta" | "setup-required"
    popular: true,                       // only for genuinely prominent tools
    addedOn: "2026-01-10",               // ISO date; drives the New Tools rail
    actionLabel: "Compress",             // primary CTA verb
    features: ["…", "…", "…", "…"],      // 4–6 bullets
    howItWorks: ["…", "…", "…"],         // 3–4 steps
    faq: [{ question: "…", answer: "…" }, /* 3–5 */],
    related: ["image-resizer", "image-converter"],
  },
];
```

The export name **must** be exactly one of:
`IMAGE_TOOLS`, `PDF_TOOLS`, `VIDEO_TOOLS`, `AUDIO_TOOLS`, `TEXT_TOOLS`, `AI_TOOLS`,
`DEVELOPER_TOOLS`.

### Rules

1. `id`, `route`, `slug` must be unique. `validateRegistry()` in
   `lib/tools/registry.ts` checks this and the admin page surfaces failures.
2. `related` entries must be real tool ids. Prefer ids from *your* category; use
   cross-category ids only where genuinely useful.
3. `processing` must be truthful:
   - `local` — works entirely in the browser (Canvas, Web Audio, WebCodecs, Web Crypto).
   - `server` — posts to an API route. If you did not build the route, the tool is
     `status: "setup-required"` and MUST set `setupNote` naming the exact env var.
   - `ai` — calls the AI provider. Needs `AI_API_KEY`; otherwise `setup-required`.
4. `icon` must be a member of the `ToolIconName` union in `lib/tools/types.ts`. Full
   list is also the `TOOL_ICONS` record in `components/tools/ToolIcon.tsx`.
5. Never claim a capability the tool does not have. If a browser cannot do it, say
   so in the FAQ and mark the tool `beta` or `setup-required`.
6. `description` doubles as the meta description. Write it for a human, not a crawler.

## Workspace components you own: `components/tools/workspaces/<category>/<Name>.tsx`

Every workspace is a **Client Component** with `"use client"` at the top and
`"use client"`-safe imports only.

### The shell

The tool page already renders the header, breadcrumb, FAQ, how-it-works and related
tools. Your workspace renders **only the interactive area**, at the top of the page.

```tsx
"use client";
import { ToolShell } from "@/components/tools/ToolShell";

export default function ImageCompressorWorkspace() {
  return (
    <ToolShell>
      {/* your UI */}
    </ToolShell>
  );
}
```

`ToolShell` props: `children`, `className?`, `footer?`.

### Use the shared components — do not re-implement them

| Import | Use for |
| --- | --- |
| `components/tools/FileDropzone` | **All** file input. Drag & drop, browse, validation, remove, clear-all, reorder. |
| `components/tools/FilePreview` | `ImagePreview`, `AudioPreview`, `VideoPreview`, `FilePreviewCard`, `AutoFilePreview` |
| `components/tools/DownloadButton` | `DownloadButton`, `CopyButton`, `OpenButton`, `DownloadGroup` (batch + ZIP), `RenameOutput` |
| `components/tools/ProgressBar` | `ProgressBar` with `stage`, `percent`, `detail`, `caption` |
| `components/tools/states` | `ToolEmptyState`, `ToolError`, `ToolSuccess`, `Notice` |
| `components/tools/BeforeAfter` | `BeforeAfter`, `BeforeAfterSlider`, `SizeComparisonStats` |
| `components/tools/ShareTool` | `CopyToClipboardButton` |
| `components/ui/*` | `Button`, `Card`, `Badge`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Slider`, `Segmented`, `Stat`, `Field`, `Tabs`, `Progress`, `Modal` |
| `lib/hooks` | `useFiles`, `useObjectUrl`, `useAsyncTask`, `useDebouncedValue` |
| `lib/utils/files` | `validateFiles`, `sanitizeFilename`, `withExtension`, `downloadBlob`, `downloadZipBatch`, `sumSizes` |
| `lib/utils/format` | `formatBytes`, `formatPercent`, `percentSaved`, `formatDuration`, `formatNumber` |
| `lib/utils/toast` | `toast.success / error / rejected / downloadReady / copy / saved / processingComplete` |

`Form.tsx` exports `Field` (label + hint + error wired for screen readers),
`Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Slider`, `Segmented`, `Stat`.
Use `Field` for anything with a label.

### File size limits

Use the constants from `lib/site.ts` → `SITE.limits.{image|pdf|video|audio|text}`.
Never hardcode `50 * 1024 * 1024` inline.

### States (mandatory on every tool)

| State | What to render |
| --- | --- |
| Empty | `ToolEmptyState` — copy is already written: "Drop your files here to get started." |
| Working | `ProgressBar` with `stage` and an honest `percent` (or `null` for indeterminate) |
| Success | Result panel + `DownloadButton`, plus `toast.processingComplete()` |
| Error | `ToolError` — never a raw stack trace, never a thrown Error string |

### Long-running results

`ProgressBar` with `percent={null}` is correct when a ratio is unknowable. Two
cases need more than a bar:

- **Streaming output.** `POST /api/ai/chat/stream` returns `text/event-stream`
  frames (`delta` / `done` / `error`), and `streamChatTurn()` in
  `components/tools/workspaces/ai/ai-client.ts` appends each delta as it lands.
  Show the text as it arrives. Do **not** animate it in afterwards and do not
  type it out with a timer — a simulated typewriter is a fake progress indicator
  wearing a costume. While the first token is still in flight the honest state is
  "Writing…", because time-to-first-token is not knowable in advance.
- **User-cancellable work.** Wire an `AbortController` to the button that stops
  it, pass its signal to `fetch`, and on abort **keep whatever arrived** and say
  it stopped early. Aborting is not an error; do not show one.

Progress honesty rules (hard requirement):
- Report `percent` only when you can actually compute it (e.g. `done / total` files,
  or a known byte offset).
- When you cannot, pass `null`. The bar renders indeterminate. **Never** animate a
  fake percentage toward 100.
- `stage` moves `preparing → processing → finalizing → complete`.

### Object URLs

`useObjectUrl(blob)` from `lib/hooks` returns a URL and revokes it on change/unmount.
Use it instead of calling `URL.createObjectURL` directly. If you manage URLs
yourself, revoke them in the effect cleanup.

### Accessibility

- Every control has an accessible name. Icon-only buttons need `aria-label`.
- Errors use `role="alert"`; progress uses `role="progressbar"` (built in).
- Keyboard reachable and operable. Dropzones: Enter/Space opens the picker.
- `<audio>`/`<video>` need the eslint-disable comment for `media-has-caption`.
- Never rely on colour alone to convey state.

## Engine code

Put pure processing logic in `lib/tools/engines/<name>.ts` when it is shared or
long enough to deserve tests. Engines must be:

- Pure where possible: `(input, options) => Promise<output>`.
- Free of React. No DOM rendering — they may use browser APIs (`Image`, `canvas`,
  `AudioContext`, `OfflineAudioContext`, `crypto`) because they run client-side.
- Dynamically imported when they pull in a heavy dependency, e.g.
  `const { PDFDocument } = await import("pdf-lib")`. Heavy libs must never be in the
  homepage bundle or a category page bundle.

## Registering the workspace

**Do not hand-edit `components/tools/workspaces/registry.tsx`.** It is generated:

```bash
node scripts/sync-workspaces.mjs --write   # regenerate
node scripts/sync-workspaces.mjs --check   # CI: fail if it is stale
```

The script walks `components/tools/workspaces/**` and writes one
`dynamic(() => import(...))` line per workspace, keyed by the tool `id` from the
registry. It fails loudly if a tool has no workspace or a workspace has no tool,
so a typo in an id cannot silently produce a dead page. `dynamic` gives each tool
its own chunk, so opening one tool never downloads the code for any other.

A registered workspace takes **no props**. It looks its own tool up from the
registry, so there is exactly one source of metadata and a workspace cannot be
handed the wrong tool:

```tsx
const tool = getTool("image-compressor");

export default function ImageCompressorWorkspace() {
  if (!tool) return <MissingTool id="image-compressor" />;
  return <ToolShell>{/* … */}</ToolShell>;
}
```

A component that takes `{ tool }` as a prop is an *inner* component — fine for a
panel shared between two tools (`AiPdfChatPanel`), wrong for a registry entry,
which will not typecheck.

## Definitions of done

1. `npm run typecheck` passes.
2. `npm run lint` passes.
3. The tool genuinely works — no dead buttons, no placeholder text, no fake numbers.
4. Every state listed above is reachable and styled.
5. File validation uses `validateFiles`/`useFiles`; oversized or wrong-type files
   produce a visible rejection, not a silent no-op.
6. Downloads work and the filename is sanitised.
7. `processing` in the definition matches reality.
