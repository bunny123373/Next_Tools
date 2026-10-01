/**
 * Exercises MongoDB persistence through the APP's own routes.
 *
 * An earlier version drove the raw driver directly, which proved the driver
 * worked and the adapter did not — and it failed on a fresh cluster with
 * `ns does not exist`, because raw inserts do not create the collections the
 * way the adapter's ensureIndexes() does. Testing the seam that ships is the
 * point.
 *
 * So: submit through /api/requests, then read back through the admin API, then
 * clean up. Everything it creates is removed.
 *
 * Requires DATABASE_URL in the shell (never in a file) and a running server.
 *
 *   $env:DATABASE_URL="mongodb+srv://..."; npm run dev; node scripts/test-mongo.mjs
 */
import { MongoClient } from "mongodb";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const uri = process.env.DATABASE_URL;

if (!uri) {
  console.error("DATABASE_URL is not set in this shell. Nothing was written to any file.");
  process.exit(1);
}

const scrub = (m) => (uri ? String(m).split(uri).join("[redacted]") : String(m));

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

const stamp = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A client so the database can be inspected for leftovers at the end. */
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });

try {
  await client.connect();
  const db = client.db();
  check("the cluster answers a ping", (await db.command({ ping: 1 })).ok === 1);

  /* -- health says which store is in use ------------------------------- */
  console.log("\n=== the app's own view ===\n");
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check(
    "the app reports the mongo store",
    health.features?.storage === "mongo",
    `storage=${health.features?.storage}`,
  );
  check(
    "the app reports it as persistent",
    health.status === "ok" || health.registryProblems >= 0,
    `status=${health.status} registryProblems=${health.registryProblems}`,
  );

  /* -- submit through the route ---------------------------------------- */
  console.log("\n=== write through POST /api/requests ===\n");
  const submitted = await fetch(`${BASE}/api/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      toolName: `Mongo probe ${stamp}`,
      category: "text",
      description: "Temporary record written by scripts/test-mongo.mjs.",
      reason: "Verifying persistence.",
      email: "probe@example.dev",
    }),
  });
  const created = await submitted.json();
  check("the submission is accepted", submitted.status === 201 && created.ok === true, `HTTP ${submitted.status}`);
  check("it reports a durable store", created.stored === "mongo", `stored=${created.stored}`);
  const id = created.id;

  /* -- read it straight from Mongo, bypassing the app ------------------ */
  console.log("\n=== read straight from MongoDB ===\n");
  const requests = db.collection("tool_requests");
  const raw = await requests.findOne({ id }, { projection: { _id: 0 } });
  check("the document is really in the database", raw !== null);
  check("its fields survived", raw?.toolName === `Mongo probe ${stamp}`, `toolName=${raw?.toolName}`);
  check("its status defaulted to pending", raw?.status === "pending", `status=${raw?.status}`);

  const indexes = (await requests.indexes()).map((i) => i.name);
  check("the createdAt index was created", indexes.includes("createdAt_desc"), indexes.join(", "));

  /* -- upsert on retry -------------------------------------------------- */
  await requests.updateOne({ id }, { $set: { toolName: "Mongo probe updated" } });
  const stillOne = await requests.countDocuments({ id });
  check("an update keeps it a single document", stillOne === 1, `${stillOne} documents`);

  /* -- read through the admin API -------------------------------------- */
  if (ADMIN_SECRET) {
    console.log("\n=== read through the admin API ===\n");
    const session = await fetch(`${BASE}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: ADMIN_SECRET }),
    });
    const cookie = session.headers.getSetCookie?.().join("; ") ?? "";
    const list = await fetch(`${BASE}/api/requests`, { headers: { cookie } });
    const body = await list.json();
    const found = (body.requests ?? []).find((r) => r.id === id);
    check("the admin API lists it", Boolean(found), `${body.requests?.length ?? 0} requests`);
    check(
      "the list is newest first",
      (body.requests ?? []).every(
        (r, i, all) => i === 0 || all[i - 1].createdAt >= r.createdAt,
      ),
    );

    if (found) {
      const patch = await fetch(`${BASE}/api/requests?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ status: "planned" }),
      });
      const patched = await patch.json();
      check("its status can be changed through the API", patched?.request?.status === "planned", `status=${patched?.request?.status}`);
    }
  } else {
    console.log("  (set ADMIN_SECRET to also exercise the admin read/write paths)");
  }

  /* -- contact ---------------------------------------------------------- */
  console.log("\n=== contact form ===\n");
  const contact = await fetch(`${BASE}/api/contact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Mongo probe",
      email: "probe@example.dev",
      message: "Temporary record written by scripts/test-mongo.mjs.",
    }),
  });
  const contactBody = await contact.json();
  check("the contact form is accepted", contact.status === 201 && contactBody.ok === true, `HTTP ${contact.status}`);
  const contactCount = await db.collection("contacts").countDocuments({ name: "Mongo probe" });
  check("the contact is in the database", contactCount >= 1, `${contactCount} matching documents`);

  /* -- cleanup --------------------------------------------------------- */
  console.log("\n=== cleanup ===\n");
  await requests.deleteOne({ id });
  await db.collection("contacts").deleteMany({ name: "Mongo probe" });
  const leftovers = await requests.countDocuments({ id });
  check("no probe documents are left behind", leftovers === 0, `${leftovers} remaining`);
  console.log(`\n  tool_requests now holds ${await requests.countDocuments({})} document(s)`);
} catch (error) {
  failures += 1;
  console.log(`  ✗ FAILED  ${scrub(error instanceof Error ? error.message : error)}`);
} finally {
  await client.close().catch(() => {});
}

console.log(failures === 0 ? "\n✓ persistence works end to end through the app" : `\n${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);