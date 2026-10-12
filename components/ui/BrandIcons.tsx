import * as React from "react";

/**
 * Brand glyphs.
 *
 * lucide-react removed third-party brand icons in v1, which is a sensible
 * decision on their part — those marks are not the project's to license. Rather
 * than pull in an icon pack, the remaining ones are inlined here. They are
 * `currentColor`, so they inherit the surrounding text colour like any other
 * icon, and each is marked `aria-hidden` because the link text or its
 * `aria-label` already names the network.
 *
 * GitHub, YouTube and Instagram were removed along with their links. `SITE.social`
 * and the `NEXT_PUBLIC_SOCIAL_*` variables are deliberately left in place, so
 * restoring a channel means bringing back the glyph and its usage, not rewiring
 * configuration.
 */

type IconProps = React.SVGProps<SVGSVGElement>;

export function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M17.53 3h3.06l-6.69 7.64L21.75 21h-5.9l-4.62-6.04L5.94 21H2.88l7.15-8.17L2.25 3h6.05l4.18 5.52L17.53 3Zm-1.07 16.15h1.7L7.6 4.75H5.79l10.67 14.4Z" />
    </svg>
  );
}

/** WhatsApp and Telegram, used by the share menu. */
export function WhatsAppIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.67c2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.25 8.24a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24Zm-2.6 3.6c-.16 0-.42.06-.64.3-.22.24-.85.83-.85 2.02s.87 2.34.99 2.5c.12.16 1.7 2.7 4.19 3.68 2.07.81 2.49.65 2.94.61.45-.04 1.45-.6 1.66-1.17.2-.58.2-1.07.14-1.17-.06-.1-.22-.16-.46-.28-.24-.12-1.45-.71-1.67-.8-.22-.08-.39-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.28.18-.52.06-.24-.12-1.03-.38-1.96-1.21-.73-.65-1.22-1.45-1.36-1.69-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.34-.76-1.83-.2-.48-.4-.41-.55-.42h-.47Z" />
    </svg>
  );
}

export function TelegramIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M21.9 4.3 18.7 19.4c-.24 1.06-.87 1.32-1.76.82l-4.86-3.58-2.34 2.26c-.26.26-.48.48-.98.48l.35-4.94 8.98-8.12c.39-.35-.08-.54-.6-.2L6.15 13.3l-4.78-1.5c-1.04-.32-1.06-1.04.22-1.54L20.5 2.9c.87-.32 1.63.2 1.4 1.4Z" />
    </svg>
  );
}
