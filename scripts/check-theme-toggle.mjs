/**
 * Measures what the theme toggle actually does, in a real browser.
 *
 * Reads the computed colours before and after clicking the real toggle button,
 * and reports the difference. Also checks the tokens themselves, because the
 * suspicion is that the two token families disagree rather than that the button
 * is unwired.
 *
 *   node scripts/check-theme-toggle.mjs [url]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PORT = 9950 + (process.pid % 40);

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

const profile = mkdtempSync(join(tmpdir(), "balu-theme-"));
const chrome = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
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
    } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error("no debugging target");
}

const READ = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const darkVisible = [...document.querySelectorAll(".dark-only")]
    .map((n) => getComputedStyle(n).display !== "none");
  const lightVisible = [...document.querySelectorAll(".light-only")]
    .map((n) => getComputedStyle(n).display !== "none");
  return {
    theme: document.documentElement.dataset.theme ?? null,
    colorScheme: cs.colorScheme,
    canvas: body.backgroundColor,
    ink: body.color,
    surfaceCanvas: cs.getPropertyValue("--surface-canvas").trim(),
    textInk: cs.getPropertyValue("--text-ink").trim(),
    colorCanvas: cs.getPropertyValue("--color-canvas").trim(),
    colorInk: cs.getPropertyValue("--color-ink").trim(),
    darkIconShown: darkVisible.some(Boolean),
    lightIconShown: lightVisible.some(Boolean),
  };
})()`;

try {
  const t = await target();
  const cdp = connect(t.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(4500);

  const before = (await cdp.send("Runtime.evaluate", { expression: READ, returnByValue: true })).result.value;

  // Click the real toggle in the navbar.
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const b = [...document.querySelectorAll("button")]
        .find((n) => /switch to (light|dark) mode/i.test(n.getAttribute("aria-label") || ""));
      if (b) { b.click(); return true; }
      return false;
    })()`,
    returnByValue: true,
  }).then((r) => check("the toggle button exists and was clickable", r.result.value === true));
  await sleep(700);

  const after = (await cdp.send("Runtime.evaluate", { expression: READ, returnByValue: true })).result.value;

  console.log("\n=== before ===\n");
  console.log(JSON.stringify(before, null, 2));
  console.log("\n=== after ===\n");
  console.log(JSON.stringify(after, null, 2));

  console.log("\n=== does it work ===\n");
  check("data-theme actually flips", before.theme !== after.theme, `${before.theme} -> ${after.theme}`);
  check("color-scheme follows", before.colorScheme !== after.colorScheme, `${before.colorScheme} -> ${after.colorScheme}`);
  check(
    "the page background actually changes",
    before.canvas !== after.canvas,
    `${before.canvas} -> ${after.canvas}`,
  );
  check(
    "the text colour actually changes",
    before.ink !== after.ink,
    `${before.ink} -> ${after.ink}`,
  );
  check(
    "the sun/moon icon swaps",
    before.darkIconShown !== before.lightIconShown || after.darkIconShown !== after.lightIconShown,
    `dark ${before.darkIconShown}->${after.darkIconShown}, light ${before.lightIconShown}->${after.lightIconShown}`,
  );

  console.log("\n=== do the two token families agree ===\n");
  check(
    "--surface-canvas matches the dark theme value",
    before.theme === "dark" ? before.surfaceCanvas !== "#f7f7f8" : true,
    `--surface-canvas=${before.surfaceCanvas} while data-theme=${before.theme}`,
  );
  check(
    "--color-canvas is the dark palette",
    before.colorCanvas === "#050505",
    `--color-canvas=${before.colorCanvas}`,
  );
  check(
    "declared color-scheme agrees with the rendered background",
    (before.colorScheme.includes("dark") && before.canvas.match(/rgb\((\d+), (\d+), (\d+)\)/) &&
      Number(RegExp.$1) < 60) ||
      (before.colorScheme.includes("light") && Number(RegExp.$1) > 200),
    `color-scheme=${before.colorScheme}, canvas=${before.canvas}`,
  );

  cdp.close();
} catch (error) {
  failures += 1;
  console.log(`\n  ✗ FAILED  ${error instanceof Error ? error.message : error}\n`);
} finally {
  bye();
}

console.log(failures === 0 ? "\n✓ the toggle works\n" : `\n${failures} problem(s)\n`);
process.exit(failures === 0 ? 0 : 1);
