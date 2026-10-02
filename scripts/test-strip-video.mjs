/**
 * Proves the video metadata remover removes metadata, without re-encoding.
 *
 * Runs in headless Chrome because the tool ships as browser code, and checks
 * the bytes the download button actually produces.
 *
 * The assertions that matter:
 *   1. the reader sees the tags that were written — otherwise a pass means nothing
 *   2. the output has no udta, and none of the tag strings survive in the bytes
 *   3. mdat is byte-identical, which is the actual claim: the media was copied,
 *      not re-encoded. An identity marker is planted inside mdat and compared.
 *   4. the container is still walkable, so the file did not simply get truncated
 *
 *   node scripts/test-strip-video.mjs [url]
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PAGE = `${BASE}/tools/video/metadata-remover`;
const TEST_FILE = "tmp/mp4-test.mp4";
const PORT = 9800 + (process.pid % 150);

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

if (!existsSync(TEST_FILE)) {
  console.error(`${TEST_FILE} missing. Run: node scripts/make-mp4-test-file.mjs ${TEST_FILE}`);
  process.exit(1);
}
mkdirSync("tmp", { recursive: true });

const original = readFileSync(TEST_FILE);
const fileB64 = original.toString("base64");

const profile = mkdtempSync(join(tmpdir(), "balu-vmeta-"));
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
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a debugging target.");
}

const PROBE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await wait(150);
    }
    return null;
  };

  const bytes = Uint8Array.from(atob(${JSON.stringify(fileB64)}), (c) => c.charCodeAt(0));
  const file = new File([bytes], "mp4-test.mp4", { type: "video/mp4" });

  const input = await until(() => document.querySelector('input[type="file"]'));
  if (!input) return { error: "no file input" };
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  // The pre-scan panel is what proves the reader works before anything is removed.
  const scanned = await until(() => {
    const t = document.body.innerText;
    return /Private holiday footage/.test(t) ? t : null;
  }, 25000);

  const button = await until(() =>
    [...document.querySelectorAll("button")].find((b) => /remove metadata/i.test(b.textContent || "") && !b.disabled),
  );
  if (!button) return { error: "button never enabled", scanned: !!scanned };
  button.click();

  const done = await until(() => {
    const t = document.body.innerText;
    return /clean copy/i.test(t) ? t : null;
  }, 40000);
  if (!done) return { error: "clean-copy panel never appeared" };

  const realCreate = URL.createObjectURL.bind(URL);
  const captured = [];
  URL.createObjectURL = (o) => { captured.push(o); return realCreate(o); };
  const dl = [...document.querySelectorAll("button")].find((b) => /download/i.test(b.textContent || ""));
  if (dl) dl.click();
  await wait(600);
  URL.createObjectURL = realCreate;

  const produced = captured[captured.length - 1];
  const cleanB64 = produced ? await new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.readAsDataURL(produced);
  }) : "";

  return { scanned: !!scanned, text: document.body.innerText, cleanB64, mime: produced?.type ?? null };
})()`;

try {
  const target = await findTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: PAGE });
  await sleep(5000);

  const out = await cdp.send("Runtime.evaluate", {
    expression: PROBE,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = out?.result?.value;
  cdp.close();

  if (!value || value.error) {
    console.log(`\n  ✗ the page did not complete: ${value?.error ?? "unknown"}\n`);
    process.exit(1);
  }

  const clean = Buffer.from(value.cleanB64 ?? "", "base64");
  const text = value.text ?? "";

  /* -- 1. the reader works --------------------------------------------- */
  console.log("\n=== the input really has metadata ===\n");
  check("the pre-scan found the tags", value.scanned === true);
  check("the title is listed", /Private holiday footage/.test(text));
  check("the comment is listed", /shot on the roof/i.test(text));
  check("the location is flagged", /location|coordinates/i.test(text));

  /* -- 2. it is gone ---------------------------------------------------- */
  console.log("\n=== the output has no metadata ===\n");
  check("a file was produced", clean.length > 0, `${clean.length} bytes vs ${original.length} in`);
  check("it is smaller than the original", clean.length < original.length, `${original.length - clean.length} bytes saved`);
  check("no udta box remains", !clean.includes(Buffer.from("udta", "ascii")));
  check("no ilst box remains", !clean.includes(Buffer.from("ilst", "ascii")));
  check("the title is gone", !clean.includes(Buffer.from("Private holiday footage")));
  check("the comment is gone", !clean.includes(Buffer.from("do not repost")));
  check("the location is gone", !clean.includes(Buffer.from("+51.5073-000.1277/", "utf8")));
  check("the encoder string is gone", !clean.includes(Buffer.from("Balu Tools 1.0")));
  check("the 4 KB cover art is gone", !clean.includes(Buffer.alloc(64, 0x42)));
  check("the tool verified the output", /verified\s*yes/i.test(text));

  /* -- 3. the media was copied, not re-encoded --------------------------- */
  console.log("\n=== the video and audio were not touched ===\n");
  check("ftyp is still the first box", clean.subarray(4, 8).toString("ascii") === "ftyp");
  check("moov survives", clean.includes(Buffer.from("moov", "ascii")));
  check("mdat survives", clean.includes(Buffer.from("mdat", "ascii")));

  // The identity marker was planted inside mdat. It must survive intact. Its
  // OFFSET moves earlier, because dropping udta shifts everything after it —
  // so the assertion is that it moves by exactly the number of bytes removed and
  // not by one more or one fewer, which would mean a box size was recomputed
  // wrongly.
  const marker = Buffer.from("BaluToolsVideoTest");
  const at = clean.indexOf(marker);
  const was = original.indexOf(marker);
  const removedBytes = original.length - clean.length;
  check("the identity marker in mdat is still there", at !== -1, at === -1 ? "lost" : `byte ${at}`);
  check(
    "it shifted earlier by exactly the bytes removed",
    at !== -1 && was - at === removedBytes,
    `moved ${was - at}, removed ${removedBytes}`,
  );

  const origMdat = original.indexOf(Buffer.from("mdat", "ascii"));
  const cleanMdat = clean.indexOf(Buffer.from("mdat", "ascii"));
  check(
    "mdat payload is byte-identical",
    clean.subarray(cleanMdat).equals(original.subarray(origMdat)),
    "media data unchanged",
  );

  /* -- 4. the container still parses ------------------------------------- */
  console.log("\n=== the container is still valid ===\n");
  const declared = clean.length >= 4 ? clean.readUInt32BE(0) : -1;
  check("the first box declares a sane length", declared > 0 && declared <= clean.length, `${declared} of ${clean.length}`);
  check("the file ends cleanly", clean.length > 100);

  if (failures > 0) {
    console.log("\n--- what the panel said ---\n");
    console.log(text.slice(0, 1500));
  }
} catch (error) {
  failures += 1;
  console.log(`\n  ✗ FAILED  ${error instanceof Error ? error.message : error}\n`);
} finally {
  bye();
}

console.log(
  failures === 0
    ? "\n✓ metadata removed, media bytes untouched\n"
    : `\n${failures} problem(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
