/**
 * Proves the metadata remover removes metadata, in the environment it uses.
 *
 * The engine calls createImageBitmap and canvas.toBlob, so it cannot run under
 * plain Node no matter how the imports are wired. Testing it in Node would mean
 * testing a different program. So this loads the real tool page in headless
 * Chrome, uploads a file that genuinely carries EXIF and GPS, clicks the real
 * button, and reads the real panel.
 *
 * That also means every assertion is about what a user would see, not about an
 * internal return value.
 *
 * Three claims, each able to fail:
 *   1. the inspector can see what was written into the file — otherwise the
 *      remover has nothing to remove and a pass would prove nothing
 *   2. the output really is clean, checked by reading the produced bytes back
 *   3. the picture survived — same dimensions, still decodable
 *
 *   node scripts/test-strip-metadata.mjs [url]
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PAGE = `${BASE}/tools/image/metadata-remover`;
const TEST_IMAGE = "tmp/exif-test.jpg";
/* Derived from the pid so parallel check runs do not fight over one port. */
const PORT = 9700 + (process.pid % 250);

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

/* -- fixtures --------------------------------------------------------------- */

if (!existsSync(TEST_IMAGE)) {
  console.error(`${TEST_IMAGE} missing. Run: node scripts/make-exif-test-image.mjs ${TEST_IMAGE}`);
  process.exit(1);
}
mkdirSync("tmp", { recursive: true });
const imageB64 = readFileSync(TEST_IMAGE).toString("base64");

/* -- headless Chrome -------------------------------------------------------- */

/* A fresh temp profile each run. Reusing one lets a previous crashed Chrome's
 * singleton lock survive and the new process exits silently, which looks
 * exactly like "Chrome did not expose a debugging target". */
const profile = mkdtempSync(join(tmpdir(), "balu-strip-"));

const chrome = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
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

const bye = () => spawn("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });

function connect(url) {
  const socket = new WebSocket(url);
  let next = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    msg.error ? entry.reject(new Error(msg.error.message)) : entry.resolve(msg.result);
  });
  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true });
    }),
    send(method, params = {}) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (!(await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) {
        await sleep(250);
        continue;
      }
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a debugging target.");
}

/* The whole test, run inside the page. */
const PROBE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, timeout = 20000) => {
    const untilAt = Date.now() + timeout;
    while (Date.now() < untilAt) {
      const value = fn();
      if (value) return value;
      await wait(120);
    }
    return null;
  };

  const b64 = ${JSON.stringify(imageB64)};
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], "exif-test.jpg", { type: "image/jpeg" });

  // Reach into the dropzone's own input rather than synthesising a drop event,
  // so the file goes through the same onChange the app listens to.
  const input = await until(() => document.querySelector('input[type="file"]'));
  if (!input) return { error: "no file input on the page" };

  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  const button = await until(() =>
    [...document.querySelectorAll("button")].find((b) => /remove metadata/i.test(b.textContent || "") && !b.disabled),
  );
  if (!button) return { error: "the action button never became enabled" };
  button.click();

  // Wait for the results panel, which only renders once verification is done.
  const heading = await until(() =>
    [...document.querySelectorAll("h2,h3,h4,div")].find((n) => /clean copy/i.test(n.textContent || "") && n.children.length === 0),
  );
  if (!heading) return { error: "the clean-copy panel never appeared" };

  await wait(400);
  const text = document.body.innerText;

  // The download button mints its object URL on click rather than on render, so
  // there is no anchor to read. Intercepting createObjectURL and then clicking
  // the real button tests the path a user actually takes, and yields the exact
  // bytes they would have received.
  const realCreate = URL.createObjectURL.bind(URL);
  const captured = [];
  URL.createObjectURL = (obj) => {
    captured.push(obj);
    return realCreate(obj);
  };

  const toB64 = async (blob) =>
    new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] || "");
      r.readAsDataURL(blob);
    });

  const download = [...document.querySelectorAll("button")].find((b) =>
    /download/i.test(b.textContent || ""),
  );
  if (download) download.click();
  await wait(500);
  URL.createObjectURL = realCreate;

  const produced = captured[captured.length - 1];
  const cleanB64 = produced ? await toB64(produced) : "";

  const img = document.createElement("img");
  const src = produced ? realCreate(produced) : "";
  const dims = src ? await new Promise((res) => {
    img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => res(null);
    img.src = src;
  }) : null;

  return {
    text,
    cleanB64,
    dims,
    mime: produced?.type ?? null,
    producedCount: captured.length,
  };
})()`;

try {
  const target = await findTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: PAGE });
  await sleep(4500); // dev/prod compile of the tool page

  const result = await cdp.send("Runtime.evaluate", {
    expression: PROBE,
    awaitPromise: true,
    returnByValue: true,
  });

  const value = result?.result?.value;
  cdp.close();

  if (!value || value.error) {
    console.log(`\n  ✗ the page did not complete: ${value?.error ?? "unknown"}\n`);
    process.exit(1);
  }

  const text = value.text ?? "";
  const clean = Buffer.from(value.cleanB64 ?? "", "base64");

  /* -- 1. it found the metadata -------------------------------------------- */
  console.log("\n=== the input really has metadata ===\n");
  const tagCount = /Tags removed\s*(\d+)/i.exec(text)?.[1];
  check("the panel counts the removed tags", Boolean(tagCount) && Number(tagCount) > 0, tagCount ? `${tagCount} tags` : "no count shown");
  check("the camera make is listed", /BaluTools/.test(text));
  check("the camera model is listed", /MetadataTestCam 9000/.test(text));
  check("the GPS block is listed", /Coordinates/i.test(text));
  check("the coordinates are shown", /-?\d{1,3}\.\d{4,}/.test(text), (/-?\d{1,3}\.\d{4,}/.exec(text) ?? [])[0]);
  check("the editing software is listed", /Balu Tools 1\.0/.test(text));

  /* -- 2. the output is clean ---------------------------------------------- */
  console.log("\n=== the output is clean ===\n");
  check("the download button produced a file", value.producedCount > 0 && clean.length > 0, `${clean.length} bytes`);
  check("it is a JPEG", value.mime === "image/jpeg", value.mime ?? "no type");
  check("it verified the output clean", /verified clean\s*yes/i.test(text));
  check(
    "the produced bytes contain no camera name",
    clean.length > 0 && !clean.includes(Buffer.from("BaluTools")),
  );
  check(
    "the produced bytes contain no model",
    clean.length > 0 && !clean.includes(Buffer.from("MetadataTestCam")),
  );
  check(
    "the produced bytes contain no software string",
    clean.length > 0 && !clean.includes(Buffer.from("Balu Tools 1.0")),
  );
  check(
    "the produced bytes contain no APP1 Exif header",
    clean.length > 0 && !clean.includes(Buffer.from("Exif\0\0", "ascii")),
  );

  /* -- 3. the picture survived --------------------------------------------- */
  console.log("\n=== the picture survived ===\n");
  check("the output still decodes", value.dims !== null, value.dims ? `${value.dims.width}x${value.dims.height}` : "failed to load");
  check(
    "the dimensions are unchanged",
    value.dims?.width === 1 && value.dims?.height === 1,
    `expected 1x1, got ${value.dims?.width}x${value.dims?.height}`,
  );
  check("it still starts with the JPEG marker", clean[0] === 0xff && clean[1] === 0xd8);

  if (failures > 0) {
    console.log("\n--- what the panel actually said ---\n");
    console.log(text.slice(0, 1600));
  }
} catch (error) {
  failures += 1;
  console.log(`\n  ✗ FAILED  ${error instanceof Error ? error.message : error}\n`);
} finally {
  bye();
}

console.log(
  failures === 0
    ? "\n✓ metadata is really removed, and the picture is intact\n"
    : `\n${failures} problem(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
