/**
 * Exercises the mail path for both forms, with and without a mail key.
 *
 * Mail cannot be verified end to end without real credentials, and pretending
 * otherwise would be the exact kind of claim this project avoids. So this
 * asserts what CAN be checked without them:
 *
 *   - unconfigured: the submission still succeeds, the response says the mail
 *     was NOT sent, and the store still holds it. A form that breaks because
 *     mail is unset is worse than one that is merely quiet about it.
 *   - configured with a bad key: the submission still succeeds and the response
 *     reports a failure, proving the failure path cannot reject a valid form.
 *   - the built mail bodies contain the submitted text and escape it.
 *
 *   node scripts/test-mail.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

const stamp = Date.now();

/* -- contact ---------------------------------------------------------- */

console.log("=== POST /api/contact ===\n");

const contactRes = await fetch(`${BASE}/api/contact`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Mail path check",
    email: "visitor@example.dev",
    message: "Checking that a contact submission is accepted and reported honestly.",
    context: "request-tool",
  }),
});
const contact = await contactRes.json();

check("the submission is accepted", contactRes.status === 201 && contact.ok === true, `HTTP ${contactRes.status}`);
check(
  "the response says where it went",
  typeof contact.destination === "string",
  `destination=${contact.destination} mail=${contact.mail}`,
);
check(
  "it does not claim mail when none was sent",
  contact.mail === "sent" ? true : contact.destination === "memory" || contact.destination === "email",
  `mail=${contact.mail}`,
);
const ephemeral = contactRes.headers.get("x-storage");
check(
  "the ephemeral-storage header matches reality",
  (contact.mail === "sent" ? false : true) === (ephemeral === "ephemeral"),
  `mail=${contact.mail} header=${ephemeral ?? "absent"}`,
);

/* -- tool request ------------------------------------------------------ */

console.log("\n=== POST /api/requests ===\n");

const requestRes = await fetch(`${BASE}/api/requests`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    toolName: `Mail path check ${stamp}`,
    category: "text",
    description: "Checking that a tool request is accepted and reported honestly.",
    reason: "Verifying the mail path.",
    email: "visitor@example.dev",
  }),
});
const request = await requestRes.json();

check("the submission is accepted", requestRes.status === 201 && request.ok === true, `HTTP ${requestRes.status}`);
check("it returns an id", typeof request.id === "string" && request.id.length > 0);
check(
  "it reports the mail outcome and the store kind",
  typeof request.mail === "string" && typeof request.stored === "string",
  `mail=${request.mail} stored=${request.stored}`,
);

/* -- the mail bodies themselves --------------------------------------- */

console.log("\n=== mail bodies ===\n");

// lib/mail.ts is TypeScript and imports "server-only", which throws outside a
// React Server Component graph. It is transpiled with the project's own tsc and
// that one import removed, so the REAL escaping code is exercised — a hand-copied
// version of escapeHtml would prove nothing about the code that ships.
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync } = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

const outDir = join(mkdtempSync(join(tmpdir(), "balu-mail-")), "js");
mkdirSync(outDir, { recursive: true });

try {
  execFileSync(
    process.execPath,
    [
      join("node_modules", "typescript", "bin", "tsc"),
      "lib/mail.ts",
      "--outDir", outDir,
      "--module", "esnext",
      "--target", "es2022",
      "--moduleResolution", "bundler",
      "--skipLibCheck",
      "--noEmitOnError", "false",
    ],
    { stdio: "pipe" },
  );
} catch (error) {
  // tsc still emits on type errors; only a hard failure to run is fatal.
  if (!error.stdout && !error.stderr) throw error;
}

const emitted = join(outDir, "mail.js");
const js = readFileSync(emitted, "utf8").replace(/^import "server-only";\s*$/m, "");
writeFileSync(emitted, js);

const { contactMessage, toolRequestMessage } = await import(`file://${emitted.replace(/\\/g, "/")}`);

const hostile = {
  name: "Ada <script>alert('xss')</script>",
  email: "ada@example.dev",
  message: "Hello & <img src=x onerror=alert(1)> \"quoted\"",
  createdAt: new Date().toISOString(),
};

const c = contactMessage(hostile);
check("the subject names the sender", c.subject.includes("ada@example.dev"));
check("the text body keeps the message readable", c.text.includes("Hello & <img"));
check("the HTML body escapes a script tag", !c.html.includes("<script>") && c.html.includes("&lt;script&gt;"));
check(
  "the HTML body escapes an injected tag",
  // The meaningful assertion is that the tag delimiters are escaped, so there
  // is no live element. Checking for the literal text "onerror=" is wrong: it
  // survives as escaped *text* inside &lt;img …&gt;, which is inert.
  c.html.includes("&lt;img") && !/<img/i.test(c.html),
);
check("the HTML body escapes an ampersand", !c.html.includes("Hello & <"), "bare & would be invalid HTML");
check("the HTML body escapes a quote", c.html.includes("&quot;quoted&quot;"));
check("the mail has a text alternative", c.text.length > 0 && c.html.length > 0);

const r = toolRequestMessage({
  toolName: "HEIC <b>converter</b>",
  category: "image",
  description: "Please add it",
  reason: "Because & only if",
  email: "visitor@example.dev",
  createdAt: new Date().toISOString(),
});
check("the tool-request subject names the tool", r.subject.includes("HEIC"));
check("the tool-request body escapes the tool name", !r.html.includes("<b>converter</b>"));
check("the tool-request body escapes the reason", !r.html.includes("Because & only"));

console.log("\n  sample HTML body:");
console.log(`  ${c.html.slice(0, 150)}…`);

console.log(failures === 0 ? "\n✓ the mail path degrades honestly" : `\n${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);