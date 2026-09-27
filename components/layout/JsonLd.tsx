/**
 * Renders a JSON-LD block.
 *
 * Two deliberate choices:
 *  - A plain `<script>`, not `next/script`. Structured data must be in the
 *    initial HTML for crawlers, and each instance needs a unique id.
 *  - `<` is escaped to `<` so a description containing `</script>`
 *    cannot break out of the tag. Registry text is our own, but this is a
 *    cheap guarantee and the pattern costs nothing.
 */
export function JsonLd({ data }: { data: unknown }) {
  if (!data) return null;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON-LD requires raw text; the payload is escaped above.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
