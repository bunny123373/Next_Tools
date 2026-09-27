/**
 * Route smoke test.
 *
 * Hits the running dev server and reports the status of every route the UI can
 * link to, plus a sample of tool pages from each category. Run with the dev
 * server up:  node scripts/check-routes.mjs
 *
 * Exits non-zero if any expected route is not 200, so it works as a CI gate.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const STATIC_ROUTES = [
  "/",
  "/tools",
  "/tools/image",
  "/tools/pdf",
  "/tools/video",
  "/tools/audio",
  "/tools/text",
  "/tools/ai",
  "/tools/developer",
  "/favorites",
  "/recent",
  "/dashboard",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/faq",
  "/request-tool",
  "/api-docs",
  "/pricing",
  "/tool-builder",
  "/offline",
  "/sitemap.xml",
  "/robots.txt",
  "/manifest.webmanifest",
  "/api/health",
  "/api/tools",
  // These must NOT exist.
  "/tools/nope",
  "/tools/image/does-not-exist",
  "/this-page-should-not-exist",
];

async function probe(path) {
  try {
    const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
    return { path, status: response.status };
  } catch (error) {
    return { path, status: 0, error: String(error) };
  }
}

const results = [];
for (const path of STATIC_ROUTES) {
  results.push(await probe(path));
  process.stdout.write(".");
}
console.log();

/* Tool pages come from the registry, so read it via the API. */
let toolPaths = [];
try {
  const response = await fetch(`${BASE}/api/tools?limit=200`);
  const payload = await response.json();
  if (payload.ok) toolPaths = payload.tools.map((tool) => tool.route);
} catch {
  console.error("could not read the tool catalogue from /api/tools");
}

console.log(`probing ${toolPaths.length} tool routes…`);
const toolResults = [];
for (const path of toolPaths) {
  toolResults.push(await probe(path));
}

const expectedFailures = new Set([
  "/tools/nope",
  "/tools/image/does-not-exist",
  "/this-page-should-not-exist",
]);

const problems = [
  ...results.filter(
    (r) => (expectedFailures.has(r.path) ? r.status < 400 : r.status !== 200),
  ),
  ...toolResults.filter((r) => r.status !== 200),
];

console.log(`\nchecked ${results.length} static + ${toolResults.length} tool routes`);

if (problems.length === 0) {
  console.log("✓ all routes returned the expected status");
  process.exit(0);
}

console.log(`\n✗ ${problems.length} problem(s):`);
for (const problem of problems.slice(0, 40)) {
  const expectation = expectedFailures.has(problem.path) ? "expected >=400" : "expected 200";
  console.log(`  ${problem.status || "ERR"}  ${problem.path}  (${expectation})`);
}
if (problems.length > 40) console.log(`  …and ${problems.length - 40} more`);
process.exit(1);
