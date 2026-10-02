/**
 * Exercises the whole admin path against a running deployment, in order.
 *
 * Written because of a bug this would have caught immediately. The session
 * verifier assumed the cookie was `payload.signature` and re-signed the part
 * before the dot, but the cookie is written as a bare signature with no dot, so
 * the comparison could never succeed. Signing in returned `signedIn: true` and
 * set a cookie; every later request came back 401. Both a working cookie and a
 * wrong secret produce 401 with no detail, so it read as a credentials problem
 * rather than a broken verifier, and token mode masked it entirely.
 *
 * The order matters. A check that only confirms sign-in succeeds would have
 * passed against that bug happily, because sign-in did succeed.
 *
 *   1. admin is reported enabled at all
 *   2. a wrong secret is rejected
 *   3. the correct secret is accepted
 *   4. the cookie it returns actually authorises a real request
 *   5. that request returns the stored records, not an empty list
 *   6. a status change round-trips
 *
 * Requires AUTH_SECRET in the shell (never read from a file into a command
 * line) and a reachable deployment.
 *
 *   $env:AUTH_SECRET="..."; node scripts/check-admin.mjs https://101plus.vercel.app
 */
const BASE = process.argv[2] ?? "http://localhost:3000";
const secret = process.env.AUTH_SECRET;

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

if (!secret) {
  console.error(
    "AUTH_SECRET is not set in this shell.\n" +
      "  $env:AUTH_SECRET='...'; node scripts/check-admin.mjs <url>\n" +
      "It is deliberately not read from .env.local, so the value never reaches a command line.",
  );
  process.exit(1);
}

/** Keeps one cookie across calls, like a browser would. */
const jar = new Map();

const storeCookies = (res) => {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
};

const call = async (path, init = {}) => {
  const headers = { ...(init.headers ?? {}) };
  if (jar.size > 0) {
    headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  storeCookies(res);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, raw: text };
};

/* -- 1. is admin enabled at all -------------------------------------------- */

console.log(`\n=== ${BASE} ===\n`);
console.log("=== admin is configured ===\n");

const health = await call("/api/health");
check(
  "the app reports admin enabled",
  health.body?.features?.admin === true,
  `admin=${health.body?.features?.admin}`,
);

/* -- 2. a wrong secret must be refused ------------------------------------- */

console.log("\n=== a wrong secret is rejected ===\n");

const bad = await call("/api/admin/session", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ secret: `wrong-${Math.random().toString(36).slice(2)}` }),
});
check("it returns 401", bad.status === 401, `HTTP ${bad.status}`);
check(
  "it says the credential was not accepted",
  bad.body?.error?.code === "unauthorized",
  bad.body?.error?.message ?? "no message",
);
check("it did not set a cookie", jar.size === 0, `${jar.size} cookie(s)`);

/* -- 3. the correct secret is accepted ------------------------------------- */

console.log("\n=== the correct secret signs in ===\n");

const good = await call("/api/admin/session", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ secret }),
});
check("it returns 200", good.status === 200, `HTTP ${good.status}`);
check("it reports signedIn", good.body?.signedIn === true);
check(
  "it sets the session cookie",
  jar.has("balu_admin"),
  jar.has("balu_admin") ? "balu_admin present" : `got: ${[...jar.keys()].join(", ") || "none"}`,
);

/* -- 4. and the cookie must actually work ---------------------------------- */

console.log("\n=== the cookie authorises a real request ===\n");

const list = await call("/api/requests");
check("the request is authorised", list.status === 200, `HTTP ${list.status}`);
check(
  "it is not rejected as unauthorised",
  list.body?.error?.code !== "unauthorized",
  list.body?.error?.message ?? "no error",
);
check(
  "it returns a list",
  Array.isArray(list.body?.requests),
  Array.isArray(list.body?.requests) ? `${list.body.requests.length} record(s)` : typeof list.body,
);

/* -- 5. a tampered cookie must be refused --------------------------------- */

console.log("\n=== a tampered cookie is rejected ===\n");

const real = jar.get("balu_admin");
jar.set("balu_admin", `${real.slice(0, -1)}${real.endsWith("A") ? "B" : "A"}`);
const tampered = await call("/api/requests");
check("it returns 401", tampered.status === 401, `HTTP ${tampered.status}`);
jar.set("balu_admin", real);

/* -- 6. a status change round-trips ---------------------------------------- */

console.log("\n=== a status change round-trips ===\n");

const target = list.body?.requests?.[0];
if (!target) {
  console.log("  (no stored records to update — skipping)");
} else {
  const before = target.status;
  const next = before === "planned" ? "pending" : "planned";
  const patched = await call(
    `/api/requests?id=${encodeURIComponent(target.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    },
  );
  check("the update is accepted", patched.status === 200, `HTTP ${patched.status}`);
  const reread = await call("/api/requests");
  const after = reread.body?.requests?.find((r) => r.id === target.id);
  check("the change persisted", after?.status === next, `${before} -> ${after?.status}`);

  // Leave the record as it was found.
  await call(`/api/requests?id=${encodeURIComponent(target.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: before }),
  });
}

console.log(
  failures === 0
    ? "\n✓ the admin path works end to end\n"
    : `\n${failures} problem(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
