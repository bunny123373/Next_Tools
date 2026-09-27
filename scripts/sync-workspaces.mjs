/**
 * Generates `components/tools/workspaces/registry.tsx` from whatever workspace
 * files actually exist on disk.
 *
 * Why generate rather than hand-maintain: the mapping is ~100 lines of
 * `dynamic(() => import(...))` where a single typo means a tool silently
 * renders "workspace not registered". Generating it from the filesystem makes
 * the mapping impossible to typo, and the mismatch report makes an *omission*
 * impossible to miss.
 *
 * Run: `node scripts/sync-workspaces.mjs [--check] [--write]`
 *
 *   (no flag)  print the report and the proposed file
 *   --check    exit 1 if the registry is out of date (for CI)
 *   --write    rewrite the registry file
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = join(ROOT, "components", "tools", "workspaces");
const REGISTRY_PATH = join(WORKSPACE_ROOT, "registry.tsx");

const args = new Set(process.argv.slice(2));

/* ------------------------------------------------------------------ */
/*  Discover                                                           */
/* ------------------------------------------------------------------ */

const SKIP_DIRS = new Set(["shared", "registry.tsx"]);
const SKIP_FILES = new Set([
  "ai-client.ts",
  "controls.tsx",
  "useAiStatus.tsx",
  "MissingTool.tsx",
  "pdf-text.ts",
]);

/** Files that are building blocks rather than a whole tool workspace. */
const NOT_A_WORKSPACE = new Set([
  "AiTextWorkspace",
  "AiImageWorkspace",
  "AiPdfChatPanel",
  "TextWorkbench",
  "FileStage",
]);

/**
 * The few places where a workspace filename does not kebab-case to its tool id.
 * Keeping these explicit is better than loosening the matcher: a deliberate
 * alias is reviewable, a fuzzy match is not.
 */
const ID_ALIASES = {
  "pdf-compressor": "pdf-compress",
  "reading-time-calculator": "reading-time",
  "lorem-ipsum-generator": "lorem-ipsum",
  "text-diff-checker": "text-diff",
};

/** `ImageCompressorWorkspace` → `image-compressor` */
function toKebabId(basename) {
  const kebab = basename
    .replace(/Workspace$/, "")
    .replace(/Panel$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return ID_ALIASES[kebab] ?? kebab;
}

/** Pull the default export name out of a workspace file. */
function defaultExportName(source) {
  const patterns = [
    /export\s+default\s+function\s+(\w+)/,
    /export\s+default\s+const\s+(\w+)/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1];
  }
  return null;
}

const entries = [];

for (const dirName of readdirSync(WORKSPACE_ROOT, { withFileTypes: true })) {
  if (!dirName.isDirectory()) continue;
  if (SKIP_DIRS.has(dirName.name)) continue;

  const dir = join(WORKSPACE_ROOT, dirName.name);
  for (const fileName of readdirSync(dir)) {
    if (!fileName.endsWith(".tsx")) continue;
    if (SKIP_FILES.has(fileName)) continue;

    const base = fileName.replace(/\.tsx$/, "");
    if (NOT_A_WORKSPACE.has(base)) continue;

    const source = readFileSync(join(dir, fileName), "utf8");
    const exportName = defaultExportName(source);
    if (!exportName) {
      entries.push({
        dir: dirName.name,
        base,
        importPath: `./${dirName.name}/${base}`,
        exportName: null,
        id: toKebabId(base),
        warning: "no default export found — skipped",
      });
      continue;
    }

    entries.push({
      dir: dirName.name,
      base,
      importPath: `./${dirName.name}/${base}`,
      exportName,
      id: toKebabId(base),
    });
  }
}

entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/* ------------------------------------------------------------------ */
/*  Report                                                             */
/* ------------------------------------------------------------------ */

// Best-effort read of the tool ids declared in the definitions, so we can tell
// "no workspace yet" apart from "workspace with no tool".
function readToolIds() {
  const defDir = join(ROOT, "lib", "tools", "definitions");
  if (!existsSync(defDir)) return { ids: [], missingFiles: [], brokenRelated: [] };

  const ids = [];
  const missingFiles = [];
  const sources = new Map();

  for (const file of readdirSync(defDir)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(defDir, file), "utf8");
    sources.set(file, source);
    if (!/export const \w+_TOOLS/.test(source)) {
      missingFiles.push(file);
      continue;
    }
    for (const match of source.matchAll(/\n\s*id:\s*"([^"]+)"/g)) {
      ids.push(match[1]);
    }
  }

  // `related:` entries must name real tool ids, or a tool page renders dead
  // related-tool cards. Cheap to check here, annoying to debug by eye.
  const known = new Set(ids);
  const brokenRelated = [];
  for (const [file, source] of sources) {
    for (const block of source.matchAll(/related:\s*\[([^\]]*)\]/g)) {
      for (const ref of (block[1] ?? "").matchAll(/"([^"]+)"/g)) {
        if (!known.has(ref[1])) brokenRelated.push(`${file} -> ${ref[1]}`);
      }
    }
  }

  return { ids, missingFiles, brokenRelated };
}

const { ids: toolIds, missingFiles: emptyDefinitions, brokenRelated } = readToolIds();
const workspaceIds = new Set(entries.map((entry) => entry.id));

const noWorkspace = toolIds.filter((id) => !workspaceIds.has(id));
const noTool = entries.filter((entry) => !toolIds.includes(entry.id)).map((entry) => entry.id);
const skipped = entries.filter((entry) => !entry.exportName);

console.log("─".repeat(64));
console.log(`workspaces found : ${entries.length}`);
console.log(`tools in registry: ${toolIds.length}`);
if (emptyDefinitions.length > 0) {
  console.log(`empty definition files: ${emptyDefinitions.join(", ")}`);
}
console.log("─".repeat(64));

if (skipped.length > 0) {
  console.log(`\n⚠ skipped (no default export):`);
  for (const entry of skipped) console.log(`   ${entry.importPath}`);
}
if (noWorkspace.length > 0) {
  console.log(`\n⚠ tools with NO workspace (${noWorkspace.length}):`);
  for (const id of noWorkspace) console.log(`   ${id}`);
}
if (noTool.length > 0) {
  console.log(`\n⚠ workspaces with no matching tool id (${noTool.length}):`);
  console.log("   check these by hand — the kebab-case guess may be off:");
  for (const id of noTool) console.log(`   ${id}`);
}
if (brokenRelated.length > 0) {
  console.log(`\n✗ broken \`related\` references (${brokenRelated.length}):`);
  for (const ref of brokenRelated) console.log(`   ${ref}`);
}
if (noWorkspace.length === 0 && noTool.length === 0 && skipped.length === 0) {
  console.log("\n✔ every tool has a workspace and every workspace has a tool");
}

/* ------------------------------------------------------------------ */
/*  Generate                                                           */
/* ------------------------------------------------------------------ */

const byCategory = new Map();
for (const entry of entries) {
  if (!entry.exportName) continue;
  const list = byCategory.get(entry.dir) ?? [];
  list.push(entry);
  byCategory.set(entry.dir, list);
}

const groups = [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));

const body = groups
  .map(([category, list]) => {
    const lines = list.map(
      (entry) => `  "${entry.id}": dynamic(() => import("${entry.importPath}")),`,
    );
    return [`  // ${category}`, ...lines].join("\n");
  })
  .join("\n\n");

const generated = `import * as React from "react";
import dynamic from "next/dynamic";
import type { Tool } from "@/lib/tools/types";
import { ToolShell, SetupRequired } from "@/components/tools/ToolShell";
import { Notice } from "@/components/tools/states";
import { Wrench } from "lucide-react";

/**
 * Tool id → workspace component.
 *
 * >>> GENERATED FILE — do not edit by hand. <<<
 * Regenerate with:  node scripts/sync-workspaces.mjs --write
 *
 * Every entry uses \`next/dynamic\`, which gives each tool its own chunk. That is
 * what keeps a heavy dependency (pdf-lib, pdfjs, lamejs, gifenc) out of the
 * category page and the homepage: opening one tool downloads only that tool's
 * code, and the rest stay on disk.
 *
 * The key MUST equal the tool's \`id\` in \`lib/tools/definitions/<category>.ts\`.
 * \`/admin/tools\` reports any tool whose workspace is missing.
 */
type WorkspaceComponent = React.ComponentType;

export const WORKSPACES: Record<string, WorkspaceComponent> = {
${body}
};

export function getWorkspace(toolId: string): WorkspaceComponent | null {
  return WORKSPACES[toolId] ?? null;
}

/**
 * Renders a tool's workspace, or an honest explanation if the mapping is
 * missing. This turns "a developer forgot to register a workspace" into a clear
 * message instead of a blank panel.
 */
export function ToolWorkspace({ tool }: { tool: Tool }) {
  const Workspace = getWorkspace(tool.id);

  if (!Workspace) {
    if (tool.status === "setup-required") {
      return <SetupRequired tool={tool} />;
    }
    return (
      <ToolShell>
        <Notice tone="warning" icon={<Wrench className="size-3.5" />} title="Workspace not registered.">
          This tool is listed in the registry but its workspace component is not wired up. That is
          a bug in the build, not something you can fix — please{" "}
          <a href="/request-tool" className="underline underline-offset-2">
            let us know
          </a>
          .
        </Notice>
      </ToolShell>
    );
  }

  return <Workspace />;
}
`;

if (args.has("--check")) {
  const current = existsSync(REGISTRY_PATH) ? readFileSync(REGISTRY_PATH, "utf8") : "";
  const drift = current !== generated;
  console.log(
    drift
      ? "\n✗ registry.tsx is out of date — run: node scripts/sync-workspaces.mjs --write"
      : "\n✓ registry.tsx is up to date",
  );
  process.exit(drift ? 1 : 0);
}

if (args.has("--write")) {
  writeFileSync(REGISTRY_PATH, generated, "utf8");
  console.log(`\n✓ wrote ${relative(ROOT, REGISTRY_PATH)} (${entries.length} workspaces)`);
} else {
  console.log("\n--- proposed registry.tsx ---\n");
  console.log(generated);
  console.log("\nRe-run with --write to apply, or --check for CI.");
}
