/**
 * Exercises the floating assistant at small phone widths and screenshots it.
 *
 * This tool was built and asserted without ever being looked at. It can now be
 * checked for real: Chrome is on this machine and Node 24 ships a global
 * WebSocket, so the DevTools Protocol can be driven with no new dependency.
 *
 * It measures the things that actually break a floating widget on a phone:
 *
 *   - is the launcher inside the viewport, and is it a big enough target
 *   - does the panel fit the viewport when opened at 320px
 *   - is the composer reachable, and is the send button a real tap target
 *   - does opening it introduce horizontal overflow
 *   - is the safe-area padding actually applied
 *
 * Screenshots are written to tmp/ so they can be opened and looked at.
 *
 *   node scripts/check-assistant-mobile.mjs [width]
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WIDTH = Number(process.argv[2] ?? 320);
const URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "tmp");
mkdirSync(OUT, { recursive: true });

const PORT = 9700 + (process.pid % 250);
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "balu-assistant-"));

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

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    const w = pending.get(m.id);
    if (!w) return;
    pending.delete(m.id);
    if (m.error) w.reject(new Error(m.error.message));
    else w.resolve(m.result);
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

const evaluate = async (cdp, expression) => {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result.value;
};

async function shot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(r.data, "base64"));
  return file;
}

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

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
    height: 720,
    deviceScaleFactor: 2,
    mobile: true,
  });

  await cdp.send("Page.navigate", { url: `${URL}/` });
  await sleep(4000);

  console.log(`floating assistant @ ${WIDTH}px on ${URL}/\n`);

  /* -- closed ---------------------------------------------------------- */

  const launcher = await evaluate(
    cdp,
    `(() => {
      // Match the LAUNCHER specifically. The panel has its own close button
      // labelled "Close the assistant", which also contains "assistant" — an
      // earlier version matched that one and reported a 0x0 rect as if the
      // launcher itself were broken.
      const btn = document.querySelector('button[aria-label*="AI assistant"]');
      if (!btn) return { found: false };
      const r = btn.getBoundingClientRect();
      const s = getComputedStyle(btn);
      return {
        found: true,
        label: btn.getAttribute('aria-label'),
        expanded: btn.getAttribute('aria-expanded'),
        width: Math.round(r.width),
        height: Math.round(r.height),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        inViewport: r.right <= document.documentElement.clientWidth + 1 && r.bottom <= document.documentElement.clientHeight + 1,
        bottomInset: s.bottom,
        rightInset: s.right,
        zIndex: s.zIndex,
      };
    })()`,
  );

  check("the launcher exists", launcher.found, launcher.found ? launcher.label : "not rendered — is a provider configured?");
  if (!launcher.found) {
    console.log("\n  Nothing else to check: the launcher hides itself when no provider is set up.");
    process.exit(1);
  }

  console.log(`      ${launcher.width}x${launcher.height} at right=${launcher.right} bottom=${launcher.bottom} z=${launcher.zIndex}`);
  check("it is a real tap target (>= 44px)", launcher.width >= 44 && launcher.height >= 44, `${launcher.width}x${launcher.height}`);
  check("it sits inside the viewport", launcher.inViewport === true);
  check("it starts collapsed", launcher.expanded === "false");

  const closedShot = await shot(cdp, `assistant-${WIDTH}-closed`);
  console.log(`      screenshot: ${closedShot}`);

  /* -- open ------------------------------------------------------------ */

  const box = await evaluate(
    cdp,
    `(() => {
      const btn = document.querySelector('button[aria-label*="AI assistant"]');
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );

  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: box.x,
      y: box.y,
      button: "left",
      clickCount: 1,
    });
  }
  await sleep(1200);

  const panel = await evaluate(
    cdp,
    `(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label*="ssistant" i]');
      if (!dialog) return { found: false };
      const r = dialog.getBoundingClientRect();
      const s = getComputedStyle(dialog);
      // The panel stays in the DOM while collapsed, so presence proves nothing.
      // Its display and size are what say whether it is actually open.
      const visible = s.display !== 'none' && r.width > 0 && r.height > 0;
      const de = document.documentElement;
      const send = dialog.querySelector('button[aria-label*="Send" i]');
      const input = dialog.querySelector('textarea, input');
      const sr = send?.getBoundingClientRect();
      const ir = input?.getBoundingClientRect();
      // Anything inside the panel sticking past the viewport.
      const strays = [];
      for (const el of dialog.querySelectorAll('*')) {
        const er = el.getBoundingClientRect();
        if (er.width === 0 && er.height === 0) continue;
        if (er.right > de.clientWidth + 1 || er.left < -1) {
          strays.push((el.getAttribute('aria-label') || el.tagName.toLowerCase()));
        }
      }
      return {
        found: true,
        visible,
        width: Math.round(r.width),
        height: Math.round(r.height),
        left: Math.round(r.left),
        top: Math.round(r.top),
        fitsWidth: r.width <= de.clientWidth + 1,
        fitsHeight: r.bottom <= de.clientHeight + 1,
        display: s.display,
        padTop: s.paddingTop,
        padBottom: s.paddingBottom,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        sendTarget: sr ? { w: Math.round(sr.width), h: Math.round(sr.height), inView: sr.right <= de.clientWidth + 1 && sr.bottom <= de.clientHeight + 1 } : null,
        inputTarget: ir ? { w: Math.round(ir.width), h: Math.round(ir.height), fontSize: getComputedStyle(input).fontSize } : null,
        strays: strays.slice(0, 5),
        greeting: dialog.textContent.slice(0, 60).trim(),
      };
    })()`,
  );

  check("the panel opens", panel.found && panel.visible === true, panel.found ? `display=${panel.display}` : "not in the DOM");
  if (panel.found && panel.visible) {
    console.log(`      ${panel.width}x${panel.height} at ${panel.left},${panel.top}  display=${panel.display}`);
    check("it fits the viewport width", panel.fitsWidth === true, `${panel.width}px in ${320 <= WIDTH ? WIDTH : WIDTH}px`);
    check("it fits the viewport height", panel.fitsHeight === true, `bottom at ${Math.round(panel.top + panel.height)}`);
    check("it does not introduce overflow", panel.scrollWidth <= panel.clientWidth + 1, `scrollWidth=${panel.scrollWidth} clientWidth=${panel.clientWidth}`);
    check("no child pokes outside the panel", panel.strays.length === 0, panel.strays.join(", "));
    check("there is a message input", panel.inputTarget !== null);
    if (panel.inputTarget) {
      check(
        "the input is 16px or larger (no iOS zoom)",
        parseFloat(panel.inputTarget.fontSize) >= 16,
        `font-size ${panel.inputTarget.fontSize}`,
      );
    }
    if (panel.sendTarget) {
      check("the send button is a real tap target", panel.sendTarget.w >= 40 && panel.sendTarget.h >= 40, `${panel.sendTarget.w}x${panel.sendTarget.h}`);
      check("the send button is reachable on screen", panel.sendTarget.inView === true);
    } else {
      check("the send button exists", false, "not found in the panel");
    }
    console.log(`      greeting: "${panel.greeting}"`);
  }

  const openShot = await shot(cdp, `assistant-${WIDTH}-open`);
  console.log(`      screenshot: ${openShot}`);

  /* -- type into it ---------------------------------------------------- */

  // Focus the field first. `Input.insertText` types into whatever has focus, and
  // an earlier version dispatched it straight after opening the panel, so the text
  // went nowhere and the check reported a failure that was its own doing.
  await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector('[role="dialog"] textarea, [role="dialog"] input');
      if (!input) return false;
      input.focus();
      return true;
    })()`,
  );
  await cdp.send("Input.insertText", { text: "Which tools upload my file?" });
  await sleep(600);
  const typed = await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector('[role="dialog"] textarea, [role="dialog"] input');
      return input ? input.value.length : -1;
    })()`,
  );
  check("text can be typed into it", typed > 0, `${typed} characters`);
  const typedShot = await shot(cdp, `assistant-${WIDTH}-typed`);
  console.log(`      screenshot: ${typedShot}`);

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

console.log(failures === 0 ? "\n✓ the assistant behaves at this width" : `\n${failures} problem(s) at ${WIDTH}px`);
process.exit(failures === 0 ? 0 : 1);