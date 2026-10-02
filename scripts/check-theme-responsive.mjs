/**
 * Checks the theme toggle on every device width, in both themes.
 *
 * The bug this was written for: `data-theme` flipped and the sun/moon icon
 * swapped, so the toggle looked alive, while every page stayed light in both
 * themes. Computed styles caught it. A single width would have caught it too —
 * the failure was not device-specific — but "works on my screen" is how a
 * layout bug survives, so all the real breakpoints are checked anyway.
 *
 * Widths: 320 (smallest phone), 375 (iPhone), 768 (tablet portrait),
 * 1024 (tablet landscape / small laptop), 1440 (desktop).
 *
 * Asserts, per width:
 *   - a toggle is present and has a tap target of at least 40x40
 *   - the mobile menu carries its own labelled control below 640px
 *   - background and text colours genuinely differ between dark and light
 *   - the declared color-scheme agrees with what is actually rendered, so
 *     native UI does not end up dark-on-light
 *   - the contrast between text and background clears WCAG AA (4.5:1)
 *
 *   node scripts/check-theme-responsive.mjs [url]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PORT = 9700 + (process.pid % 120);
const WIDTHS = [320, 375, 768, 1024, 1440];
const SHOTS = "tmp/theme";

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`    ✗ ${msg}`);
};

/* -- colour maths ----------------------------------------------------------- */

function parseRgb(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value ?? "");
  if (!m) return null;
  const parts = m[1].split(",").map((n) => Number(n.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* -- browser ---------------------------------------------------------------- */

mkdirSync(SHOTS, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "balu-theme-r-"));
const chrome = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--hide-scrollbars",
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

async function findTarget() {
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

/* Force a theme by writing the attribute directly, so the check does not
 * depend on a toggle existing in order to test the tokens. */
const SET_THEME = `(t) => {
  document.documentElement.dataset.theme = t;
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
}`;

const READ = `(() => {
  const html = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const toggle = [...document.querySelectorAll("button")]
    .find((b) => /switch to (light|dark) mode/i.test(b.getAttribute("aria-label") || ""));
  const r = toggle?.getBoundingClientRect();
  const menuToggle = [...document.querySelectorAll("#mobile-nav button")]
    .find((b) => /switch to (light|dark) mode/i.test(b.getAttribute("aria-label") || ""));
  return {
    theme: document.documentElement.dataset.theme,
    colorScheme: html.colorScheme,
    canvas: body.backgroundColor,
    ink: body.color,
    card: getComputedStyle(document.documentElement).getPropertyValue("--surface-card").trim(),
    toggleW: r ? Math.round(r.width) : null,
    toggleH: r ? Math.round(r.height) : null,
    menuTogglePresent: Boolean(menuToggle),
    menuToggleW: menuToggle ? Math.round(menuToggle.getBoundingClientRect().width) : null,
  };
})()`;

const OPEN_MENU = `(() => {
  const b = [...document.querySelectorAll("button")]
    .find((n) => /open menu/i.test(n.getAttribute("aria-label") || ""));
  if (!b) return false;
  b.click();
  return true;
})()`;

try {
  const t = await findTarget();
  const cdp = connect(t.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  for (const width of WIDTHS) {
    console.log(`\n=== ${width}px ===\n`);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await cdp.send("Page.navigate", { url: BASE });
    await sleep(2600);

    const evaluate = async (expression, awaitPromise = false) =>
      (await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }))
        .result.value;

    const read = async () => evaluate(READ);

    /* dark, then light, forced through the attribute */
    await evaluate(`(${SET_THEME})("dark")`, true);
    const dark = await read();
    await evaluate(`(${SET_THEME})("light")`, true);
    const light = await read();

    /* -- the toggle itself -- */
    if (dark.toggleW === null) fail("no theme toggle found in the header");
    else {
      if (dark.toggleW < 40 || dark.toggleH < 40) {
        fail(`tap target is ${dark.toggleW}x${dark.toggleH}, under the 40x40 minimum`);
      }
      if (dark.menuToggleW !== null && dark.menuToggleW < 200) {
        fail(`mobile menu control is only ${dark.menuToggleW}px wide`);
      }
    }

    /* -- the themes must actually differ -- */
    if (dark.canvas === light.canvas) {
      fail(`background is identical in both themes: ${dark.canvas}`);
    }
    if (dark.ink === light.ink) {
      fail(`text colour is identical in both themes: ${dark.ink}`);
    }

    /* -- declared scheme must match what is rendered -- */
    const darkBg = parseRgb(dark.canvas);
    const lightBg = parseRgb(light.canvas);
    if (darkBg && luminance(darkBg) > 0.2) {
      fail(`data-theme=dark renders a light background (${dark.canvas})`);
    }
    if (lightBg && luminance(lightBg) < 0.5) {
      fail(`data-theme=light renders a dark background (${light.canvas})`);
    }
    if (!dark.colorScheme.includes("dark")) {
      fail(`color-scheme is "${dark.colorScheme}" while the theme is dark`);
    }
    if (!light.colorScheme.includes("light")) {
      fail(`color-scheme is "${light.colorScheme}" while the theme is light`);
    }

    /* -- contrast, both themes -- */
    for (const [name, state] of [["dark", dark], ["light", light]]) {
      const ratio = contrast(parseRgb(state.ink), parseRgb(state.canvas));
      if (!(ratio >= 4.5)) {
        fail(`${name} text on background is ${ratio.toFixed(2)}:1, under WCAG AA 4.5:1`);
      }
    }

    /* -- the mobile menu control, where it belongs -- */
    if (width < 640) {
      const opened = await evaluate(OPEN_MENU);
      if (!opened) fail("no menu button to open the mobile sheet");
      else {
        await sleep(350);
        const withMenu = await read();
        if (!withMenu.menuTogglePresent) fail("the mobile sheet has no theme control");
        else if (withMenu.menuToggleW < 200) {
          fail(`the mobile sheet control is ${withMenu.menuToggleW}px wide`);
        }
        await cdp.send("Page.captureScreenshot", { format: "png" }).then((r) =>
          writeFileSync(join(SHOTS, `menu-${width}-${withMenu.theme}.png`), Buffer.from(r.data, "base64")),
        );
        await evaluate(`document.querySelector('[aria-label="Close menu"]')?.click()`);
        await sleep(200);
      }
    }

    const ok = dark.canvas !== light.canvas && dark.ink !== light.ink;
    console.log(
      `    ${ok ? "✓" : "✗"} ${width}px  dark ${dark.canvas} / light ${light.canvas}  ` +
        `toggle ${dark.toggleW}x${dark.toggleH}  contrast ` +
        `${contrast(parseRgb(dark.ink), parseRgb(dark.canvas)).toFixed(1)}:1 / ` +
        `${contrast(parseRgb(light.ink), parseRgb(light.canvas)).toFixed(1)}:1`,
    );

    for (const theme of ["dark", "light"]) {
      await evaluate(`(${SET_THEME})("${theme}")`, true);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(SHOTS, `${width}-${theme}.png`), Buffer.from(shot.data, "base64"));
    }
  }

  cdp.close();
} catch (error) {
  failures += 1;
  console.log(`\n  ✗ FAILED  ${error instanceof Error ? error.message : error}\n`);
} finally {
  bye();
}

console.log(
  failures === 0
    ? `\n✓ the toggle works at all ${WIDTHS.length} widths, in both themes\n  screenshots in ${SHOTS}/\n`
    : `\n${failures} problem(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
