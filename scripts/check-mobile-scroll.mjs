/**
 * Does the page actually scroll sideways at a given width?
 *
 * `documentElement.scrollWidth` can exceed `clientWidth` for reasons that do not
 * produce a scrollable overflow region — so it is not proof of a horizontal
 * scrollbar. The ground truth is whether the viewport can be scrolled on the x
 * axis at all: scroll to a large offset and read back `window.scrollX`.
 *
 * This is what a visitor experiences, so this is what gets asserted.
 *
 *   node scripts/check-mobile-scroll.mjs [width] [url...]
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WIDTH = Number(process.argv[2] ?? 375);
const URLS = process.argv.slice(3);
const PAGES = URLS.length > 0
  ? URLS
  : [
      "http://localhost:3000/",
      "http://localhost:3000/tools",
      "http://localhost:3000/tools/image",
      "http://localhost:3000/tools/ai/chat",
      "http://localhost:3000/tools/image/image-compressor",
      "http://localhost:3000/pricing",
      "http://localhost:3000/about",
    ];
const PORT = 9600 + (process.pid % 300);

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "balu-scroll-"));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

/**
 * Reports the real horizontal scroll range, plus the widest element by its
 * margin box — because the root's scrollable overflow is computed from margin
 * boxes, which a plain getBoundingClientRect sweep misses.
 */
const PROBE = `(() => {
  const de = document.documentElement;
  const limit = de.clientWidth;
  window.scrollTo(4000, 0);
  const scrolled = Math.round(window.scrollX);
  window.scrollTo(0, 0);

  const widest = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none') continue;
    const mr = parseFloat(s.marginRight) || 0;
    const edge = r.right + mr;
    if (edge <= limit + 1) continue;
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (['auto','scroll','hidden','clip'].includes(ps.overflowX)) { clipped = true; break; }
    }
    if (clipped) continue;
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0,3).join('.') : '';
    widest.push({
      tag: el.tagName.toLowerCase() + id + cls,
      right: Math.round(r.right),
      marginRight: mr,
      edge: Math.round(edge),
      position: s.position,
    });
  }
  widest.sort((a,b) => b.edge - a.edge);
  return {
    clientWidth: limit,
    scrollWidth: de.scrollWidth,
    scrollableBy: scrolled,
    offenders: widest.slice(0, 6),
  };
})()`;

let failures = 0;
try {
  if (!(await waitForDevTools())) {
    console.error("Chrome did not expose DevTools in time.");
    process.exit(1);
  }
  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })
  ).json();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: 780,
    deviceScaleFactor: 2,
    mobile: true,
  });

  console.log(`no page scrolls sideways at ${WIDTH}px\n`);
  for (const url of PAGES) {
    await cdp.send("Page.navigate", { url });
    await sleep(3200);
    const result = await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
    const d = result.result.value;
    const bad = d.scrollableBy > 0 || d.offenders.length > 0;
    if (bad) failures += 1;
    console.log(
      `  ${bad ? "✗" : "✓"} ${url.replace("http://localhost:3000", "") || "/"}`,
    );
    console.log(
      `      client=${d.clientWidth} scrollWidth=${d.scrollWidth} actuallyScrolledBy=${d.scrollableBy}`,
    );
    for (const o of d.offenders) {
      console.log(`      → ${o.tag} right=${o.right} marginRight=${o.marginRight} edge=${o.edge} ${o.position}`);
    }
  }
  cdp.close();
} finally {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      chrome.kill("SIGKILL");
    }
  } catch {
    /* already gone */
  }
}

console.log(failures === 0 ? "\n✓ no horizontal scroll anywhere" : `\n${failures} page(s) scroll sideways`);
process.exit(failures === 0 ? 0 : 1);