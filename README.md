<div align="center">

# 🧰 Balu Tools

### Everything you need. One simple toolbox.

**101 browser-based utility tools** — image, PDF, video, audio, text, AI and developer —
built with Next.js 16, TypeScript and Tailwind CSS v4.

[![Next.js](https://img.shields.io/badge/Next.js-16.3.6-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.3-087ea4?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Tools](https://img.shields.io/badge/Tools-101-ff3b30?style=for-the-badge&logo=googlechrome&logoColor=white)](#-whats-inside)
[![Typecheck](https://img.shields.io/badge/typecheck-0_errors-22c55e?style=for-the-badge&logo=typescript&logoColor=white)](#-quality-gates)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

<br/>

```bash
npm install && npm run dev      # → http://localhost:3000
```

**[Quick start](#-quick-start) · [What's inside](#-whats-inside) · [Architecture](#-architecture) · [Privacy](#-privacy-model) · [Configuration](#-environment-variables) · [Add a tool](#-adding-a-tool)**

</div>

---

## 💡 The one rule

<div align="center">

> ### Nothing is claimed that does not work.

</div>

A tool shown as functional **actually functions**. A tool that needs an unconfigured provider
**says so, names the exact environment variable, and refuses politely**. A tool whose quality
depends on the browser **tells you which browser**.

This is enforced in three places, not just documented:

| Rule | Where it lives |
| :--- | :--- |
| `processing` must be truthful | `lib/tools/types.ts` + every definition |
| Status resolves from real environment | `lib/tools/runtime.ts` |
| Registry invariants are checked | `validateRegistry()` in `lib/tools/registry.ts`, surfaced at `/admin/tools` |

Progress obeys the same rule. A tool that can compute a completion ratio shows one. A tool
that **cannot** — a model call, a real-time video re-encode — shows an **indeterminate** bar.
No tool animates a fabricated percentage toward 100%.

---

## 📦 What's inside

<div align="center">

| 🖼️ **Image** | 📄 **PDF** | 🎬 **Video** | 🔊 **Audio** |
| :---: | :---: | :---: | :---: |
| **16 tools** | **15 tools** | **10 tools** | **10 tools** |
| Compress, resize, crop | Merge, split, repair | Trim, crop, speed | Convert, trim, merge |
| Convert, watermark | Watermark, protect | Watermark, frames | Boost, normalise |

| ✍️ **Text** | 🧑‍💻 **Developer** | 🤖 **AI** |
| :---: | :---: | :---: |
| **13 tools** | **24 tools** | **13 tools** |
| Count, case, clean up | JSON, JWT, regex | Chat, rewrite, translate |
| Diff, sort, replace | Base64, UUID, hash | Summarise, generate images |

</div>

Every tool page is generated from a single registry, so search, category pages, related tools,
the sitemap, breadcrumbs and JSON-LD all stay in sync automatically.

---

## 🚀 Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

**No configuration required.** Every tool that can run in a browser runs out of the box.
AI and other server-backed tools render an explicit **"Setup required"** panel naming the
variable they need, rather than a button that silently fails.

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # production build
npm run check        # all three
```

---

## 🏗️ Architecture

```
app/
  tools/[category]/[slug]/   every tool page, generated from the registry
  api/                       route handlers (Zod + rate limit + safe errors)
components/
  ui/                        design system
  tools/                     workspace kit (shell, dropzone, progress, download, share)
  tools/workspaces/          per-tool UI, one lazily loaded chunk each
  layout/                    navbar, footer, theme, floating assistant
  home/ user/ admin/         feature UIs
lib/
  tools/registry.ts          single source of truth for all tool metadata
  tools/definitions/*.ts     one file per category
  tools/engines/*.ts         pure processing logic
  ai/                        provider abstraction (server-only)
  api/                       response helpers, rate limiting
  billing/                   plans + payment provider abstraction
  user/                      favourites, recents, history, local analytics
docs/TOOL_CONTRACT.md        how to add a tool
```

### 🎯 The registry is the centre

`lib/tools/registry.ts` is the only place tool data is assembled. Tool cards, search,
category pages, related tools, the sitemap, breadcrumbs, JSON-LD and the tool page router all
read from it. Adding a tool to `lib/tools/definitions/<category>.ts` makes it appear
everywhere — including in search and the sitemap — with no other edits.

### ✂️ Code splitting

Every tool workspace is registered with `next/dynamic`, giving each one its own chunk.
Heavy dependencies (`pdf-lib`, `pdfjs-dist`, `gifenc`, `lamejs`) are dynamically imported
*inside* the tool that needs them, so the homepage never downloads a PDF or video encoder.

### 🤖 The AI layer

One provider abstraction (`lib/ai/provider.ts`) fronts any OpenAI-compatible endpoint, and
is the only place the API key is ever read. The browser knows a route path and nothing else.

The conversational tools stream over server-sent events, so replies arrive word by word
rather than all at once. Only text deltas cross the wire — frames are assembled server-side,
so no credential can reach a browser.

**Generation and editing are separate models.** Most providers use one id for text-to-image
and a different one for `/images/edits`, so they are separate variables
(`AI_IMAGE_MODEL`, `AI_EDIT_MODEL`). Omitting the second falls back to the first, which is
right when one model does both. When it is wrong, the gateway usually says so in a useful
way — xkiro's is:

> Image editing is not available for model "sensenova/sensenova-u1.5-lite".
> Models that support editing: openai/gpt-image-2.5.

Two other provider differences are handled rather than exposed: some gateways answer image
requests **synchronously** and others queue a job to be polled, and some return inline bytes
while others return a CDN URL. Both shapes are handled, and a URL is downloaded server-side
under guards so the server never becomes an open proxy.

Image tools also **report real progress**. The provider's poll loop is the only thing that
knows how a queued job is going, so it is streamed to the browser rather than guessed at:
measured elapsed time and status-check count, never a percentage. Nobody knows how far
through an image a model is, and a bar that fills at a made-up rate is worse than no bar.

---

## 🔒 Privacy model

| Mode | Meaning | How it is enforced |
| :--- | :--- | :--- |
| `local` | Runs in the browser, file never transmitted | No upload code path exists in the tool |
| `server` | Uploaded, processed, temporary copy deleted at request end | Notice shown above the workspace |
| `ai` | Forwarded to the configured model provider | Notice shown; key is server-only |

Favourites, recents, processing history and usage counters live in `localStorage`.
**History stores metadata only** — tool, file *name*, sizes, outcome, timestamp. Never file
contents, never the text you typed.

**No cookies. No ad or analytics scripts.** Anonymous usage counters are off unless
`NEXT_PUBLIC_ANALYTICS_ENDPOINT` is set, and are toggleable from `/dashboard`.

### Contact and tool-request email

Both forms need somewhere to send what a visitor typed. Set `RESEND_API_KEY` and
`MAIL_FROM` and they are emailed to `MAIL_TO`. Resend's HTTP API is called directly, so
there is **no SDK and no extra dependency**; the free tier is 3,000 emails a month.

Two deliberate properties:

- **A mail failure never fails a submission.** The record is saved first, so a provider
  having a bad minute does not reject a valid form. It is visible in `/admin` either way.
- **The response says where it went.** `mail` is `sent`, `not-configured` or `failed`, and
  the page's warning only appears when *neither* mail nor a storage backend exists. A
  submission that reached nobody used to still report `delivered: true`.

Without those variables the forms still work — they are held in memory and lost on
restart, and the page says exactly that.

---

## 🔧 Environment variables

All optional. Nothing has a default credential, and **no secret is ever a `NEXT_PUBLIC_*`
variable** — those are inlined into the browser bundle.

| Variable | Enables |
| :--- | :--- |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for metadata, sitemap, share links |
| `RESEND_API_KEY` | **Delivers contact-form and tool-request email** |
| `MAIL_FROM` | The verified sender those emails come from |
| `MAIL_TO` | Where they are delivered (defaults to the contact email) |
| `AI_PROVIDER` | Provider id (default `openai-compatible`) |
| `AI_API_KEY` | Every tool in the AI category |
| `AI_BASE_URL` | Any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, Ollama…) |
| `AI_MODEL` | Chat model id |
| `AI_IMAGE_MODEL` | Text-to-image model id |
| `AI_EDIT_MODEL` | Image-editing model id, when it differs from `AI_IMAGE_MODEL` |
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

See `.env.example`. `/admin/settings` shows which are set — **presence only, never values.**

---

## 🚫 Deliberate non-features

These are gaps **on purpose**, and the UI says so rather than hiding them:

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
- **ffmpeg.wasm is not bundled.** Video tools use the native browser media pipeline, and each
  page states its real codec limits. Enabling WASM needs ~30 MB and COOP/COEP headers.

---

## ♿ Accessibility

WCAG-minded throughout: semantic landmarks, a skip link, visible focus rings, roving
tabindex on tabs and menus, `role="alert"` errors, `role="progressbar"` with real values, and
full keyboard operation. `prefers-reduced-motion` is respected globally.

Tested breakpoints: **320 / 375 / 414 / 768 / 1024 / 1440 / 1920**.

On a phone the chat inputs are **16px** so iOS Safari does not zoom the viewport on focus,
fixed elements clear the notch and the home indicator, and tap targets are at least 40px.

---

## ✅ Quality gates

| Gate | Command | Status |
| :--- | :--- | :--- |
| Types | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | clean on all files touched by the tool contract |
| Build | `npm run build` | 129 static pages |
| Routes | `node scripts/check-routes.mjs` | 30 static + 101 tool routes as expected |
| Registry | `npm run check:workspaces` | every tool has a workspace, and vice versa |
| Mobile | `npm run check:mobile` | safe-area insets, 16px inputs, sticky composer, tap targets |
| Composer | `npm run check:focus` | the shared control's focus ring is provably cancelled |
| README | `npm run check:readme` | every table-of-contents anchor resolves |

Run them all at once with `npm run check:static`. Each guard corresponds to a bug
that actually shipped, not a style preference.

---

## ➕ Adding a tool

Read **[`docs/TOOL_CONTRACT.md`](docs/TOOL_CONTRACT.md)**. In short:

1. Add a `Tool` entry to `lib/tools/definitions/<category>.ts`.
2. Create `components/tools/workspaces/<category>/<Name>.tsx` as a Client Component that
   renders `<ToolShell>`. A registered workspace takes **no props** — it looks its own tool up
   with `getTool("your-tool-id")`.
3. Run `node scripts/sync-workspaces.mjs --write` to regenerate the workspace registry.
   **Do not hand-edit it.**
4. `npm run check`.

The pages, search, sitemap, breadcrumbs, JSON-LD, related tools and category counts all update
themselves.

---

<div align="center">

### 📄 License

MIT © 2026 Balu Jeswanth — see [`LICENSE`](LICENSE). Third-party components remain under
their own licences.

**Built with care. No fake progress bars, no invented numbers.**

</div>
