/**
 * Finds what is actually too wide at a given mobile width.
 *
 * Uses Chrome headless over the DevTools Protocol, driven with Node's built-in
 * global WebSocket — no new dependency.
 *
 * Why element rects and not `documentElement.scrollWidth`: the root now has
 * `overflow-x: clip`, which makes scrollWidth equal to clientWidth even while
 * elements stick out past the right edge. So the scrollbar metric reports
 * "fine" precisely when content is being clipped. Measuring each element's
 * bounding rect is the only way to see the real problem, which is what makes
 * this script able to find something the guard concealed.
 *
 *   node scripts/find-overflow.mjs [width] [url...]
 *   node scripts/find-overflow.mjs 375 http://localhost:3000/
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WIDTH = Number(process.argv[2] ?? 375);
const URLS = process.argv.slice(3);
const PAGES = URLS.length > 0 ? URLS : ["http://localhost:3000/"];
const PORT = 9333 + (process.pid % 200);

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "balu-overflow-"));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
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
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

/** One CDP session over a WebSocket. */
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

/** Runs in the page: every element whose box crosses the right edge. */
const FIND_OVERFLOW = `(() => {
  const limit = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (rect.right <= limit + 1) continue;
    // Clipped by an ancestor with its own scroll: not a page-level problem.
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === 'auto' || ps.overflowX === 'scroll' || ps.overflowX === 'hidden' || ps.overflowX === 'clip') {
        clipped = true;
        break;
      }
    }
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 4).join('.')
      : '';
    out.push({
      tag: el.tagName.toLowerCase() + id + cls,
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      left: Math.round(rect.left),
      position: style.position,
      // Computed insets, so a positioned element's anchor can be checked
      // against what the stylesheet asked for instead of guessed at.
      csRight: style.right,
      csLeft: style.left,
      csBottom: style.bottom,
      overflowX: style.overflowX,
      clipped,
      text: (el.textContent || '').trim().slice(0, 40),
    });
  }
  return {
    viewport: limit,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootOverflowX: getComputedStyle(document.documentElement).overflowX,
    offenders: out.sort((a, b) => b.right - a.right).slice(0, 14),
    // Stop the ancestor walk at <body>: the root's own overflow-x: clip would
    // otherwise mark EVERY offender as "clipped", hiding exactly what this
    // script exists to find.
    rootOverflowX: getComputedStyle(document.documentElement).overflowX,
  };
})()`;

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

  for (const url of PAGES) {
    await cdp.send("Page.navigate", { url });
    // Give the client bundle time to hydrate and render its own chrome.
    await sleep(3500);

    const result = await cdp.send("Runtime.evaluate", {
      expression: FIND_OVERFLOW,
      returnByValue: true,
    });

    const data = result.result.value;
    const real = data.offenders.filter((o) => !o.clipped);

    console.log(`\n=== ${url} @ ${WIDTH}px ===`);
    console.log(`  viewport          ${data.viewport}px`);
    console.log(`  root overflow-x    ${data.rootOverflowX}`);
    console.log(`  doc scrollWidth    ${data.docScrollWidth}px`);
    console.log(`  body scrollWidth   ${data.bodyScrollWidth}px`);
    console.log(`  elements past the right edge: ${data.offenders.length} (${real.length} not clipped by a scrollable ancestor)`);

    if (data.offenders.length === 0) {
      console.log("  ✓ nothing overflows");
    }
    for (const o of data.offenders) {
      console.log(
        `  ${o.clipped ? "~" : "✗"} right=${String(o.right).padStart(5)} w=${String(o.width).padStart(5)} left=${String(o.left).padStart(5)} ${o.position.padEnd(8)} ${o.tag}`,
      );
      if (o.position === "fixed") {
        console.log(`       computed right=${o.csRight} left=${o.csLeft} bottom=${o.csBottom}`);
      }
      if (o.text) console.log(`       "${o.text}"`);
    }
  }

  cdp.close();
} finally {
  // Chrome spawns a whole process tree, and `child.kill()` only signals the
  // parent — leaving orphans that hold the debugging port and make the next run
  // hang. `taskkill /T /F` takes the tree with it.
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