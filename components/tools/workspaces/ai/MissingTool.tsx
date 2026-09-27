"use client";

/**
 * The failure state for a workspace whose tool id is not in the registry.
 *
 * Every workspace looks its tool up by id so there is one source of metadata.
 * If that id is wrong — a typo, or a definition that was renamed — the
 * workspace renders this instead of a blank area, which makes the mistake
 * obvious during development instead of showing an empty card on a live page.
 */

import { ToolShell } from "@/components/tools/ToolShell";
import { ToolError } from "@/components/tools/states";

export function MissingTool({ id }: { id: string }) {
  return (
    <ToolShell>
      <ToolError
        title="This tool is not registered."
        detail={`No tool with the id "${id}" exists in lib/tools/definitions/ai.ts. The workspace and the definition have drifted apart.`}
      />
    </ToolShell>
  );
}
