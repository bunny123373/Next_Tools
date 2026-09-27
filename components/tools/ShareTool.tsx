"use client";

import * as React from "react";
import { Check, Link2, Share2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { Button } from "@/components/ui/button";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { TelegramIcon, WhatsAppIcon, XIcon } from "@/components/ui/BrandIcons";

export interface ShareToolProps {
  /** Route being shared, e.g. "/tools/image/compressor". */
  path: string;
  title: string;
  text?: string;
  className?: string;
  /** Compact icon-only trigger (used in the tool header). */
  compact?: boolean;
}

/**
 * Share control for a tool page.
 *
 * Privacy: only the tool's own public route is ever shared. File names, pasted
 * text, generated output and any other user data are *not* appended to the URL,
 * so a shared link can never carry a visitor's private content.
 */
export function ShareTool({ path, title, text, className, compact }: ShareToolProps) {
  const [copied, setCopied] = React.useState(false);
  const shareUrl = React.useMemo(() => {
    if (typeof window === "undefined") return path;
    return new URL(path, window.location.origin).toString();
  }, [path]);

  const shareText = text ?? `Check out ${title} — a free browser-based tool on Balu Tools.`;

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.copied("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link", "Your browser blocked clipboard access.");
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title, text: shareText, url: shareUrl });
    } catch (error) {
      // AbortError just means the visitor dismissed the sheet.
      if ((error as Error)?.name !== "AbortError") {
        toast.error("Sharing failed", "Your browser couldn't open the share sheet.");
      }
    }
  };

  const items: DropdownItem[] = [
    { label: copied ? "Link copied" : "Copy link", onSelect: copyLink, icon: copied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" /> },
    {
      label: "WhatsApp",
      href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`,
      icon: <WhatsAppIcon className="size-3.5" />,
    },
    {
      label: "Telegram",
      href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
      icon: <TelegramIcon className="size-3.5" />,
    },
    {
      label: "Share on X",
      href: `https://x.com/intent/post?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
      icon: <XIcon className="size-3.5" />,
    },
  ];

  if (canNativeShare) {
    return (
      <Tooltip content="Share this tool">
        <Button
          variant="secondary"
          size={compact ? "icon-sm" : "sm"}
          onClick={nativeShare}
          aria-label="Share this tool"
          className={className}
        >
          <Share2 className="size-4" aria-hidden="true" />
          {compact ? null : <span>Share</span>}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Dropdown
      label={`Share ${title}`}
      align="end"
      className={className}
      items={items}
      trigger={
        <Button
          variant="secondary"
          size={compact ? "icon-sm" : "sm"}
          aria-label="Share this tool"
          className={cn("gap-2")}
        >
          <Share2 className="size-4" aria-hidden="true" />
          {compact ? null : <span>Share</span>}
        </Button>
      }
    />
  );
}

/** Standalone copy-to-clipboard button used by output panels. */
export function CopyToClipboardButton({
  value,
  label = "Copy",
  className,
}: {
  value: string | null;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={!value}
      className={className}
      aria-label={label}
      onClick={async () => {
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.copied("Copied to clipboard");
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Couldn't copy", "Your browser blocked clipboard access.");
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" aria-hidden="true" /> : null}
      {!copied ? <Link2 className="size-3.5" aria-hidden="true" /> : null}
      {label}
    </Button>
  );
}
