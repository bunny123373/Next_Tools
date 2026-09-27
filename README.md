# Balu Tools

**Everything you need. One simple toolbox.**

A collection of browser-based utility tools — image, PDF, video, audio, text, AI and
developer — built with Next.js 16 App Router, TypeScript and Tailwind CSS.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

No configuration is required. Every tool that can run in a browser runs out of the box.
AI and other server-backed tools render an explicit "Setup required" panel naming the
environment variable they need, rather than a button that silently fails.

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # production build
npm run check        # all three
```

---

## The one rule

**Nothing is claimed that does not work.**

A tool that is shown as functional actually functions. A tool that needs an unconfigured
provider says so, names the exact variable, and refuses politely. A tool whose quality
depends on the browser tells you which browser. This is enforced in three places:

| Rule | Where it lives |
| --- | --- |
| `processing` must be truthful | `lib/tools/types.ts` + every definition |
| Status resolves from real env | `lib/tools/runtime.ts` |
| Registry invariants are checked | `validateRegistry()` in `lib/tools/registry.ts`, surfaced at `/admin/tools` |

Progress is subject to the same rule. A tool that can compute a completion ratio shows one.
A tool that cannot — a model call, a real-time video re-encode — shows an **indeterminate**
bar. No tool animates a fabricated percentage toward 100%.

---

## Architecture

```
app/                        routes (App Router)
  tools/[category]/[slug]/  every tool page, generated from the registry
  api/                      route handlers (Zod + rate limit + safe errors)
components/
  ui/                       design system
  tools/                    workspace kit (shell, dropzone, progress, download, share)
  tools/workspaces/         per-tool UI, one lazily loaded chunk each
  home/ user/ admin/        feature UIs
lib/
  tools/registry.ts         single source of truth for all tool metadata
  tools/definitions/*.ts    one file per category
  tools/engines/*.ts        pure processing logic
  ai/                       provider abstraction (server-only)
  api/                      response helpers, rate limiting
  billing/                  plans + payment provider abstraction
  user/                     favourites, recents, history, local analytics
docs/TOOL_CONTRACT.md       how to add a tool
```

### The registry is the centre

`lib/tools/registry.ts` is the only place tool data is assembled. Tool cards, search,
category pages, related tools, the sitemap, breadcrumbs, JSON-LD and the tool page router
all read from it. Adding a tool to `lib/tools/definitions/<category>.ts` makes it appear
everywhere, including in the sitemap and in search — with no other edits.

### Code splitting

Every tool workspace is registered with `next/dynamic`, giving each one its own chunk.
Heavy dependencies (`pdf-lib`, `pdfjs-dist`, `gifenc`, `lamejs`) are dynamically imported
*inside* the tool that needs them, so the homepage never downloads a PDF or video encoder.

---

## Privacy model

| Mode | Meaning | How it is enforced |
| --- | --- | --- |
| `local` | Runs in the browser, file never transmitted | No upload code path exists in the tool |
| `server` | Uploaded, processed, temporary copy deleted at request end | Notice shown above the workspace |
| `ai` | Forwarded to the configured model provider | Notice shown; key is server-only |

Favourites, recents, processing history and usage counters live in `localStorage`.
**History stores metadata only** — tool, file *name*, sizes, outcome, timestamp. Never file
contents, never the text you typed.

No cookies. No ad or analytics scripts. Anonymous usage counters are off unless
`NEXT_PUBLIC_ANALYTICS_ENDPOINT` is set, and are toggleable from `/dashboard`.

---

## Environment variables

All optional. Nothing here has a default credential, and no secret is ever a
`NEXT_PUBLIC_*` variable — those are inlined into the browser bundle.

| Variable | Enables |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for metadata, sitemap, share links |
| `AI_PROVIDER` | Provider id (default `openai-compatible`) |
| `AI_API_KEY` | The 12 AI tools |
| `AI_BASE_URL` | Any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, Ollama…) |
| `AI_MODEL` | Chat model id |
| `AI_IMAGE_MODEL` | Image model id |
| `PDF_ENCRYPTION_API_KEY` | PDF password protect / remove |
| `TRANSCRIPTION_API_KEY` | Audio to Text |
| `TOOL_REQUESTS_ENDPOINT` | Persists tool requests (otherwise in-memory) |
| `CONTACT_FORM_ENDPOINT` | Where contact messages are delivered |
| `ADMIN_SECRET` | Unlocks `/admin` |
| `AUTH_SECRET` | Session-signed admin access |
| `DATABASE_URL` | Favourites/history sync, usage analytics (adapter not shipped) |
| `STRIPE_SECRET_KEY` | Subscriptions (provider adapter not shipped) |
| `NEXT_PUBLIC_ANALYTICS_ENDPOINT` | Anonymous aggregated usage counters |
| `NEXT_PUBLIC_CROSS_ORIGIN_ISOLATED` | COOP/COEP headers, only for ffmpeg.wasm |

See `.env.example`. `/admin/settings` shows which are set — presence only, never values.

---

## Deliberate non-features

These are gaps on purpose, and the UI says so rather than hiding them:

- **No accounts.** Favourites and history are browser-local. A half-built password system is
  worse than none, so sign-in waits until it can be done properly.
- **No payments.** `lib/billing/provider.ts` defines the plans and the entitlement checks, but
  checkout refuses with `not_configured`. There is no demo mode and no path that can mark a
  plan as paid.
- **No usage analytics without a database.** `/admin` reports that the data is unavailable
  rather than rendering a plausible-looking chart.
- **The tool builder does not generate code.** It maps a description onto a closed catalogue
  of existing tools. There is no `eval`, no `new Function`, and no dynamic import of a
  generated path. See `/tool-builder`.
- **ffmpeg.wasm is not bundled.** Video tools use the native browser media pipeline, and
  each page states its real codec limits. Enabling WASM needs ~30 MB and COOP/COEP headers.

---

## Accessibility

WCAG-minded throughout: semantic landmarks, a skip link, visible focus rings, roving
tabindex on tabs and menus, `role="alert"` errors, `role="progressbar"` with real values,
and full keyboard operation. `prefers-reduced-motion` is respected globally.

Tested breakpoints: 320 / 375 / 414 / 768 / 1024 / 1440 / 1920.

---

## Adding a tool

Read `docs/TOOL_CONTRACT.md`. In short:

1. Add a `Tool` entry to `lib/tools/definitions/<category>.ts`.
2. Create `components/tools/workspaces/<category>/<Name>.tsx` as a Client Component that
   renders `<ToolShell>`.
3. Register it in `components/tools/workspaces/registry.tsx` under its `id`.
4. `npm run check`.

The pages, search, sitemap, breadcrumbs, JSON-LD, related tools and category counts all
update themselves.

---

## Licence

Private project. Open-source components remain under their own licences.
