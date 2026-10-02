/**
 * Measures brand-coloured contrast in both themes.
 *
 * check-theme-responsive.mjs measures body text against the page background and
 * reports 20:1 / 18:1, which is genuinely good — and completely misses the red.
 *
 * The brand colour is used for the primary button and for accent text, and the
 * same #ff3b30 is used in both themes. Darkening it in light mode is the usual
 * answer, but whether that is needed is a number, not an opinion: #ff3b30 on
 * white is about 3.3:1 and white on #ff3b30 about 3.5:1, both under the 4.5:1
 * that WCAG AA requires for normal-sized text.
 *
 * So this walks the rendered page for every element that actually paints brand
 * colour — button fills, accent text, badges — and measures what a user sees.
 *
 *   node scripts/check-brand-contrast.mjs [url]
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PORT = 9850 + (process.pid % 40);
const PAGES = ["/", "/tools", "/pricing"];

let failures = 0;

const parse = (v) => {
  const m = /rgba?\(([^)]+)\)/.exec(v ?? "");
  if (!m) return null;
  const p = m[1].split(",").map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
};
const ch = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ({ r, g, b }) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
const ratio = (a, b) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

/** Walks up for the first non-transparent background. */
const PROBE = `(() => {
  const effBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const m = /rgba?\\(([^)]+)\\)/.exec(c);
      if (m) { const p = m[1].split(",").map(Number);
        if (p.length < 4 || p[3] > 0.9) return { r: p[0], g: p[1], b: p[2] }; }
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255 };
  };
  const isRed = (c) => { const p = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!p) return false; const q = p[1].split(",").map(Number);
    return q[0] > 150 && q[1] < 120 && q[2] < 120 && q[0] - q[1] > 60; };

  const out = [];
  for (const el of document.querySelectorAll("a,button,[role=button],span,p,h1,h2,h3")) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const own = el.textContent?.trim() ?? "";
    if (!own) continue;

    // A red-filled control with text on top.
    if (isRed(cs.backgroundColor)) {
      out.push({ kind: "filled", text: own.slice(0, 28),
        fg: cs.color, bg: cs.backgroundColor, size: parseFloat(cs.fontSize),
        weight: cs.fontWeight, page: location.pathname });
      continue;
    }
    // Red text on whatever is behind it.
    if (isRed(cs.color) && parseFloat(cs.fontSize) <= 20) {
      out.push({ kind: "text", text: own.slice(0, 28),
        fg: cs.color, bg: getComputedStyle(document.body).backgroundColor,
        size: parseFloat(cs.fontSize), weight: cs.fontWeight, page: location.pathname });
    }
  }
  return out.slice(0, 40);
})()`;

const profile = mkdtempSync(join(tmpdir(), "balu-brand-"));
const chrome = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
   "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"],
  { stdio: "ignore" },
);
const bye = () => spawn("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });

function connect(url) {
  const socket = new WebSocket(url);
  let next = 0;
  const pending = new Map();
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  });
  return {
    ready: new Promise((res, rej) => {
      socket.addEventListener("open", res, { once: true });
      socket.addEventListener("error", () => rej(new Error("cdp")), { once: true });
    }),
    send(method, params = {}) {
      const id = ++next;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) {
        const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const p = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (p) return p;
      }
    } catch { /* wait */ }
    await sleep(250);
  }
  throw new Error("no target");
}

const seen = new Map();

try {
  const t = await target();
  const cdp = connect(t.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const theme of ["dark", "light"]) {
    for (const path of PAGES) {
      await cdp.send("Page.navigate", { url: BASE + path });
      await sleep(2200);
      await cdp.send("Runtime.evaluate", {
        expression: `document.documentElement.dataset.theme = "${theme}";
          new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`,
        awaitPromise: true,
      });
      const res = await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
      for (const item of res.result.value ?? []) {
        const fg = parse(item.fg);
        const bg = parse(item.bg);
        if (!fg || !bg) continue;
        // Large text is 18.66px bold or 24px; WCAG allows 3:1 for those.
        const large = item.size >= 24 || (item.size >= 18.66 && Number(item.weight) >= 700);
        const need = large ? 3 : 4.5;
        const r = ratio(fg, bg);
        const key = `${theme}|${item.kind}|${item.text}|${item.fg}|${item.bg}`;
        if (seen.has(key)) continue;
        seen.set(key, { ...item, r, need, large });
      }
    }
  }
  cdp.close();

  const rows = [...seen.values()].sort((a, b) => a.r - b.r);
  console.log(`\n${rows.length} distinct brand-coloured elements\n`);
  console.log("theme  kind    ratio  need  text");
  for (const row of rows) {
    const ok = row.r >= row.need;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "✓" : "✗"} ${row.page.padEnd(9)} ${row.kind.padEnd(7)} ${row.r.toFixed(2).padStart(5)}  ${row.need}   ${row.text}`,
    );
  }

  const bad = rows.filter((r) => r.r < r.need);
  if (bad.length) {
    console.log(`\n  ${bad.length} below AA. Worst: ${bad[0].r.toFixed(2)}:1 needing ${bad[0].need}:1 — "${bad[0].text}"`);
  }
} catch (error) {
  failures += 1;
  console.log(`\n  ✗ FAILED  ${error instanceof Error ? error.message : error}\n`);
} finally {
  bye();
}

console.log(failures === 0 ? "\n✓ brand colour meets AA everywhere\n" : `\n${failures} problem(s)\n`);
process.exit(failures === 0 ? 0 : 1);
