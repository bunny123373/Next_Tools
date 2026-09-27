"use client";

import * as React from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useFavorites } from "@/lib/user/hooks";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export interface FavoriteButtonProps
  extends Omit<ButtonProps, "onClick" | "aria-pressed" | "variant"> {
  toolId: string;
  toolName: string;
  /** `icon` = square button for tool cards. `full` = labelled button. */
  appearance?: "icon" | "full";
}

/** Favourite toggle. Persists to localStorage; a signed-in store can mirror it. */
export function FavoriteButton({
  toolId,
  toolName,
  appearance = "icon",
  size,
  className,
  ...props
}: FavoriteButtonProps) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(toolId);
  const label = active ? `Remove ${toolName} from favourites` : `Add ${toolName} to favourites`;

  return (
    <Tooltip content={active ? "Remove from favourites" : "Add to favourites"}>
      <Button
        {...props}
        size={size ?? (appearance === "icon" ? "icon-sm" : "sm")}
        variant={appearance === "full" ? "secondary" : "ghost"}
        aria-pressed={active}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggle(toolId, toolName);
        }}
        className={cn(appearance === "icon" && "-mr-1 -mt-1", className)}
      >
        <Heart
          className={cn("size-4 transition-colors", active && "fill-brand-500 text-brand-500")}
          aria-hidden="true"
        />
        {appearance === "full" ? <span>{active ? "Saved" : "Save"}</span> : null}
      </Button>
    </Tooltip>
  );
}
