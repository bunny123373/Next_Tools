import type { Tool } from "../types";

/**
 * Developer tools.
 *
 * All of these run entirely in the browser tab. Nothing here contacts a network
 * except the API Tester, which fires the request *from the visitor's browser* —
 * and therefore still obeys CORS exactly as a `fetch` in a console would.
 */
export const DEVELOPER_TOOLS: readonly Tool[] = [
  {
    id: "json-formatter",
    name: "JSON Formatter",
    slug: "json-formatter",
    category: "developer",
    description: "Pretty-print JSON with 2 or 4 space indentation, optional key sorting, and the exact line and column of any syntax error.",
    intro:
      "Paste messy JSON and get it back readable, with the precise position of any error when it is not valid. Sorting keys and switching indent width are one click away.",
    icon: "Braces",
    keywords: ["json", "beautify", "pretty print", "indent", "format json", "pretty-print json", "prettify"],
    route: "/tools/developer/json-formatter",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-05",
    actionLabel: "Format",
    features: [
      "2-space, 4-space or tab indentation",
      "Optional key sorting, with arrays left in order",
      "Reports the line and column of a syntax error, not just a failure",
      "Shows key count, nesting depth and the size difference",
      "Copy, download, or open the result in a new tab",
    ],
    howItWorks: [
      "Paste your JSON into the input pane.",
      "Choose an indent width, and turn on key sorting if you want deterministic output.",
      "The result updates as you type, with a caret marking any error position.",
    ],
    faq: [
      {
        question: "Does my JSON leave my browser?",
        answer:
          "No. Parsing and re-serialising happen with the browser's own JSON implementation. There is no request involved, so an unsent key is never transmitted.",
      },
      {
        question: "Why does sorting keys also reorder my arrays?",
        answer:
          "It does not. Array order is significant in JSON, so arrays are always left exactly as written. Only object keys are sorted.",
      },
      {
        question: "How large a document can it handle?",
        answer:
          "It is bounded by your device's memory, not by an upload limit. A few megabytes formats instantly; tens of megabytes will make the interface sluggish, which is a browser limit rather than an artificial cap.",
      },
    ],
    related: ["json-validator", "json-minifier", "base64-encoder", "markdown-to-html"],
  },
  {
    id: "json-validator",
    name: "JSON Validator",
    slug: "json-validator",
    category: "developer",
    description: "Check that JSON is valid, find common problems, or validate it against a JSON Schema and see every violation with its path.",
    intro:
      "Three levels of checking: well-formedness, a lint pass for the mistakes that are technically valid, and JSON Schema validation with a path for each problem.",
    icon: "ShieldCheck",
    keywords: ["json", "validate", "schema", "lint", "check json", "json schema", "validation"],
    route: "/tools/developer/json-validator",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-05",
    actionLabel: "Validate",
    features: [
      "Well-formedness check with the exact error position",
      "Lint pass for duplicate keys, BOMs, NaN and Infinity",
      "JSON Schema validation: type, required, properties, items, enum, ranges, pattern",
      "$ref resolution into #/$defs",
      "Every violation reported with its JSON pointer",
    ],
    howItWorks: [
      "Paste your JSON on the left and, optionally, a schema on the right.",
      "Pick a validation level.",
      "Each failure is listed with a pointer such as /items/2/name so you can jump straight to it.",
    ],
    faq: [
      {
        question: "Which parts of JSON Schema are supported?",
        answer:
          "The commonly used subset: type, required, properties, additionalProperties, items, enum, const, minimum, maximum, exclusiveMinimum, exclusiveMaximum, minLength, maxLength, pattern, minItems, maxItems, and $ref into #/$defs. Conditional schemas such as if/then/else and oneOf are not implemented, and the tool says so rather than silently ignoring them.",
      },
      {
        question: "Is my schema uploaded anywhere?",
        answer: "No. Both documents are parsed in the tab and discarded when you close it.",
      },
      {
        question: "What counts as a valid document?",
        answer:
          "The same thing your runtime will accept: standard JSON with no comments, no trailing commas and no single quotes. If a linter or build step accepts comments and your server does not, this tool will tell you the server is right.",
      },
      {
        question: "Why does it report an error when my file looks fine?",
        answer:
          "The most common cause is a trailing comma, which most editors add silently. The message gives the line and column so you can jump straight to it rather than hunting through a large file.",
      },
    ],
    related: ["json-formatter", "json-minifier", "api-tester", "regex-tester"],
  },
  {
    id: "json-minifier",
    name: "JSON Minifier",
    slug: "json-minifier",
    category: "developer",
    description: "Strip every unnecessary byte from JSON and see the exact reduction in size, with optional key sorting.",
    intro:
      "Remove all whitespace from a JSON document and get a real measurement of how much smaller it became, down to the byte.",
    icon: "Minimize2",
    keywords: ["json", "minify", "compress", "minify json", "strip whitespace", "min"],
    route: "/tools/developer/json-minifier",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-05",
    actionLabel: "Minify",
    features: [
      "Removes all insignificant whitespace",
      "Optional key sorting for deterministic output",
      "Optional stripping of ASCII control characters",
      "Reports input size, output size and percentage saved",
      "Copy or download the minified result",
    ],
    howItWorks: [
      "Paste your JSON.",
      "Optionally sort keys and strip control characters.",
      "The minified output and the exact byte saving appear instantly.",
    ],
    faq: [
      {
        question: "Does minifying change the meaning?",
        answer:
          "No. Whitespace between JSON tokens is insignificant, so removing it is safe. String contents are never touched — whitespace inside a string value is data and is preserved exactly.",
      },
      {
        question: "Why is my file smaller?",
        answer:
          "Whitespace between JSON tokens carries no meaning, so removing it is safe. Indentation on a 500-line payload is often half the file size, which is why the saving is usually large on formatted input and almost nil on input that was already minified.",
      },
      {
        question: "Will it break my API call?",
        answer:
          "No, provided the JSON was valid to begin with. If it parses, minifying it produces the same value and the same bytes on the wire. The one thing to check is string values containing escaped whitespace, which are left exactly as they were.",
      },
    ],
    related: ["json-formatter", "json-validator", "base64-encoder"],
  },
  {
    id: "xml-formatter",
    name: "XML Formatter",
    slug: "xml-formatter",
    category: "developer",
    description: "Pretty-print XML with consistent indentation and wrapped attributes, using a real XML parser so invalid input is reported precisely.",
    intro:
      "Format XML and XML-ish config files with a spec-compliant parser, so a genuine syntax error is caught rather than silently rearranged.",
    icon: "FileCode",
    keywords: ["xml", "format", "pretty print", "indent", "pretty-print xml", "beautify", "config"],
    route: "/tools/developer/xml-formatter",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-12",
    actionLabel: "Format",
    features: [
      "Indentation width control",
      "Long attribute lists wrapped one per line",
      "CDATA sections and comments preserved verbatim",
      "Self-closing tags for empty elements",
      "Real parser errors with a line and column",
    ],
    howItWorks: [
      "Paste your XML.",
      "Choose an indent width and whether to wrap attributes.",
      "The formatted output appears as you type.",
    ],
    faq: [
      {
        question: "Is this a validator as well as a formatter?",
        answer:
          "It uses the browser's XML parser, which is strict, so genuinely malformed XML is rejected with a position. Be aware that it is not a schema validator — well-formed is not the same as valid against your XSD.",
      },
      {
        question: "Are namespaces preserved?",
        answer: "Yes. Namespace prefixes and declarations are kept as written.",
      },
      {
        question: "What happens to my original formatting?",
        answer:
          "It is replaced with consistent indentation based on nesting depth. Mixed tabs and spaces, or no indentation at all, both come out the same. Text content inside a node is never reflowed, because doing so would change the data.",
      },
    ],
    related: ["html-formatter", "json-formatter", "base64-encoder"],
  },
  {
    id: "html-formatter",
    name: "HTML Formatter",
    slug: "html-formatter",
    category: "developer",
    description: "Re-indent HTML with one tag per line, keeping inline elements, preformatted blocks and script contents intact.",
    intro:
      "Tidy up minified or badly indented HTML. Void elements, inline tags and preformatted content are handled correctly rather than reflowed.",
    icon: "FileCode",
    keywords: ["html", "format", "pretty print", "indent", "markup", "tidy", "beautify"],
    route: "/tools/developer/html-formatter",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-12",
    actionLabel: "Format",
    features: [
      "One element per line with correct nesting depth",
      "Inline elements kept on a single line with their text",
      "pre, textarea, script and style contents never reflowed",
      "Optional attribute sorting and quote normalisation",
      "Comments preserved",
    ],
    howItWorks: [
      "Paste your HTML.",
      "Set the indent width and any attribute options.",
      "Copy or download the formatted result.",
    ],
    faq: [
      {
        question: "Will this change how my page renders?",
        answer:
          "Formatting should not, but HTML whitespace is significant in some contexts — inline elements are a good example. The tool keeps inline elements on one line precisely to avoid introducing whitespace where it would be rendered. Always diff the output before shipping it.",
      },
      {
        question: "Does it fix invalid HTML?",
        answer:
          "No. It uses the browser's tolerant HTML parser, which will normalise some malformed markup as a side effect of parsing. Treat this as a formatter, not a validator.",
      },
      {
        question: "Will this remove parts of my page?",
        answer:
          "No. It parses and re-serialises the document, so the result renders the same. That said, it is a formatter rather than a repair tool - malformed markup is reported rather than guessed at, because guessing at broken HTML is how you ship a page that works on your machine and nowhere else.",
      },
    ],
    related: ["xml-formatter", "css-formatter", "javascript-formatter"],
  },
  {
    id: "css-formatter",
    name: "CSS Formatter",
    slug: "css-formatter",
    category: "developer",
    description: "Pretty-print CSS with one declaration per line, correct at-rule nesting, and no broken strings or comments.",
    intro:
      "Reformat stylesheets so every rule reads the same way. The tokeniser understands strings, comments, url() and nested blocks, so nothing inside them is mangled.",
    icon: "Palette",
    keywords: ["css", "scss", "format", "pretty print", "stylesheet", "indent", "less"],
    route: "/tools/developer/css-formatter",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-12",
    actionLabel: "Format",
    features: [
      "One declaration per line with consistent spacing",
      "@media and @supports blocks indented correctly",
      "Strings, comments and url() values never split",
      "Optional comment preservation and blank-line collapsing",
      "Indent width control",
    ],
    howItWorks: [
      "Paste your CSS.",
      "Choose an indent width.",
      "The formatted stylesheet updates live.",
    ],
    faq: [
      {
        question: "Does it handle SCSS and Less?",
        answer:
          "Partially. Variables, mixins and nesting are tokenised and indented correctly, so the output stays valid, but they are not reformatted beyond indentation.",
      },
      {
        question: "Is it safe to run on a stylesheet in production?",
        answer:
          "Yes, formatting does not change which selectors match. Run it on a copy first if the stylesheet is generated by a build step, because the next build will overwrite your changes and that is a confusing thing to debug.",
      },
      {
        question: "Does it sort my properties or remove unused rules?",
        answer:
          "No. It only adjusts whitespace and indentation. Sorting and pruning are separate opinions that can change behaviour, and a tool that quietly rewrote your cascade would be a bad neighbour.",
      },
    ],
    related: ["html-formatter", "javascript-formatter", "xml-formatter"],
  },
  {
    id: "javascript-formatter",
    name: "JavaScript Formatter",
    slug: "javascript-formatter",
    category: "developer",
    description: "Re-indent JavaScript and TypeScript with normalised spacing, using a token-aware pass that respects strings, comments and regex literals.",
    intro:
      "A lightweight, token-based formatter that fixes indentation and spacing without needing to understand your program's semantics. It is honest about its limits.",
    icon: "Code2",
    keywords: ["javascript", "js", "typescript", "format", "prettier", "indent", "beautify"],
    route: "/tools/developer/javascript-formatter",
    processing: "local",
    status: "beta",
    addedOn: "2026-01-12",
    actionLabel: "Format",
    features: [
      "Indentation and operator spacing normalisation",
      "Correctly distinguishes regex literals from division",
      "Strings, template literals and comments left untouched",
      "Optional semicolon insertion and quote-style preference",
      "Block comments preserved",
    ],
    howItWorks: [
      "Paste your JavaScript or TypeScript.",
      "Set the indent width and spacing options.",
      "The reformatted source appears live.",
    ],
    faq: [
      {
        question: "Is this as good as Prettier?",
        answer:
          "No, and it does not pretend to be. This is a token-aware formatter, not a full AST printer. It will fix indentation and spacing reliably, and it will not intelligently rewrap long lines or restructure code the way a real formatter does. For production formatting, use Prettier or Biome — they are free and better at this job.",
      },
      {
        question: "Why is it labelled beta?",
        answer:
          "Because the guarantee is narrower than a real formatter's. It tokenises correctly and normalises whitespace, but it is not a parser, so unusual syntax can defeat it. That is a real limitation, and the label reflects it.",
      },
      {
        question: "Does it understand modern syntax?",
        answer:
          "It parses current JavaScript, including optional chaining, nullish coalescing and class fields. If the parser rejects something, it says so rather than mangling it - which is why it is labelled beta: the formatting of brand-new syntax is the part most likely to differ from Prettier's output.",
      },
    ],
    related: ["css-formatter", "html-formatter", "json-formatter", "diff-checker"],
  },
  {
    id: "sql-formatter",
    name: "SQL Formatter",
    slug: "sql-formatter",
    category: "developer",
    description: "Format SQL for MySQL, PostgreSQL, SQLite or standard SQL with correct keyword casing and indentation of subqueries.",
    intro:
      "Readable SQL for long queries, with a keyword set per dialect so MySQL and PostgreSQL highlights are not mixed up.",
    icon: "Database",
    keywords: ["sql", "query", "format", "pretty print", "mysql", "postgres", "postgresql", "sqlite"],
    route: "/tools/developer/sql-formatter",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-19",
    actionLabel: "Format",
    features: [
      "MySQL, PostgreSQL, SQLite and standard SQL keyword sets",
      "Correct handling of string literals, quoted identifiers and comments",
      "WITH clauses and nested subqueries indented",
      "Upper, lower or capitalised keywords",
      "Never reformats inside a string or a comment",
    ],
    howItWorks: [
      "Paste your query.",
      "Choose a dialect and keyword casing.",
      "The formatted SQL appears instantly.",
    ],
    faq: [
      {
        question: "Why does the dialect matter?",
        answer:
          "Because the keyword sets genuinely differ. LIMIT exists in MySQL and PostgreSQL but not standard SQL; NVARCHAR is SQL Server. Choosing the wrong dialect would highlight words that are not reserved in your database.",
      },
      {
        question: "Does it change my query?",
        answer:
          "No. Only whitespace and keyword casing change. String literals, including their contents, are preserved byte for byte.",
      },
      {
        question: "Can I paste a query with placeholders?",
        answer:
          "Yes. Named placeholders like :id and positional ones like $1 are left exactly as written, so a formatted query can go straight back into your code without losing its parameters.",
      },
    ],
    related: ["json-formatter", "diff-checker", "base64-encoder"],
  },
  {
    id: "base64-encoder",
    name: "Base64 Encoder",
    slug: "base64-encoder",
    category: "developer",
    description: "Encode text or a file to Base64 and Base64URL, with correct handling of non-ASCII characters and data URIs.",
    intro:
      "Base64 encoding that gets Unicode right, because it encodes the UTF-8 bytes rather than the string's code units.",
    icon: "Binary",
    keywords: ["base64", "encode", "btoa", "data uri", "base64url", "binary"],
    route: "/tools/developer/base64-encoder",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-19",
    actionLabel: "Encode",
    features: [
      "Standard and URL-safe Base64 alphabets",
      "Correct UTF-8 handling for non-ASCII text",
      "File to data URI, including the MIME type",
      "Output size and expansion ratio",
      "Copy or download the result",
    ],
    howItWorks: [
      "Paste text, or drop a file.",
      "Choose the alphabet.",
      "Copy the encoded output.",
    ],
    faq: [
      {
        question: "Why is my output longer than the input?",
        answer:
          "That is expected. Base64 encodes 3 bytes as 4 characters, so the output is always about 33% larger. It is an encoding, not compression.",
      },
      {
        question: "What is Base64URL for?",
        answer:
          "The URL-safe alphabet replaces + and / with - and _ and drops padding, which makes the result safe to put in a URL path, a query parameter or a JWT segment.",
      },
      {
        question: "Where does Base64 actually get used?",
        answer:
          "Anywhere text has to travel through a channel that only handles plain text: SMTP headers, JSON string fields, data URIs and HTTP Basic auth. It is an encoding, not encryption - anyone can decode it, so never put a password or a secret in one.",
      },
    ],
    related: ["base64-decoder", "url-encoder", "json-minifier", "hash-generator"],
  },
  {
    id: "base64-decoder",
    name: "Base64 Decoder",
    slug: "base64-decoder",
    category: "developer",
    description: "Decode Base64 and Base64URL, tolerating missing padding and stray whitespace, and reporting the exact offset of any invalid character.",
    intro:
      "Decode Base64 without guessing. Invalid input tells you which character is wrong, and binary results can be inspected as hex instead of printed as mojibake.",
    icon: "Binary",
    keywords: ["base64", "decode", "atob", "data uri", "base64url", "unencode"],
    route: "/tools/developer/base64-decoder",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-19",
    actionLabel: "Decode",
    features: [
      "Standard and URL-safe alphabets",
      "Tolerates missing padding and embedded whitespace",
      "Exact offset reported for the first invalid character",
      "Binary output shown as a hex dump and as a data-URI preview",
      "Copy or download the decoded result",
    ],
    howItWorks: [
      "Paste your Base64 string.",
      "Decode.",
      "Text is shown as text; binary is shown as hex with a preview when it is an image.",
    ],
    faq: [
      {
        question: "Why do I get gibberish?",
        answer:
          "Almost always because the payload was not text. Base64 is an encoding, so decoding arbitrary bytes as UTF-8 gives replacement characters. Switch to the hex view to see what is actually in there.",
      },
      {
        question: "Why is my decoded output binary or unreadable?",
        answer:
          "The input was probably already binary - a compressed file or an image - rather than Base64-encoded text. The tool tells you when the decoded bytes are not valid text instead of filling the box with mojibake and letting you wonder.",
      },
      {
        question: "Does it handle URL-safe Base64?",
        answer:
          "Yes. Both the standard alphabet and the URL-safe variant are accepted, so input using - and _ instead of + and / decodes correctly.",
      },
    ],
    related: ["base64-encoder", "url-decoder", "hash-generator"],
  },
  {
    id: "url-encoder",
    name: "URL Encoder",
    slug: "url-encoder",
    category: "developer",
    description: "Percent-encode text for a URL, a query value or a path segment, and see how each component of a URL breaks down.",
    intro:
      "Encode a string for a URL, or paste a full URL and get every component decoded individually — which is usually the thing you actually need.",
    icon: "Link",
    keywords: ["url", "encode", "percent", "escape", "uri", "encodeuri", "encodeuricomponent"],
    route: "/tools/developer/url-encoder",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-19",
    actionLabel: "Encode",
    features: [
      "encodeURI and encodeURIComponent modes",
      "Query-string mode, encoding spaces as +",
      "Paste a full URL to see scheme, host, port, path, query and hash decoded separately",
      "Character-by-character explanation of what changed",
      "Copy or download the result",
    ],
    howItWorks: [
      "Paste a value, or a complete URL to analyse.",
      "Choose the encoding mode.",
      "Copy the encoded output.",
    ],
    faq: [
      {
        question: "When do I need encodeURIComponent rather than encodeURI?",
        answer:
          "Almost always encodeURIComponent for a value you are inserting. encodeURI leaves reserved characters such as &, = and ? intact, so encoding a query value with it lets the value break out of its own parameter. Use encodeURI only when you are rewriting a whole URL that already has its structure.",
      },
      {
        question: "What does it leave unencoded?",
        answer:
          "The characters that are legal in a URL and unambiguous - letters, digits and - _ . ! ~ * ' ( ) are left alone, so a path stays readable. Everything else, including spaces and slashes, becomes percent-encoded.",
      },
      {
        question: "When should I not use it?",
        answer:
          "Not on a whole URL. Encoding the entire string turns the separators into data and you end up with one long encoded string instead of a valid URL. Encode only the values that go inside it - a query parameter, a path segment - and leave the structure intact.",
      },
    ],
    related: ["url-decoder", "base64-encoder", "slug-generator"],
  },
  {
    id: "url-decoder",
    name: "URL Decoder",
    slug: "url-decoder",
    category: "developer",
    description: "Decode percent-encoded URLs and see every component — scheme, host, path, query and hash — separated and individually decoded.",
    intro:
      "Decode a URL, or break one down into its parts with each one percent-decoded. Useful when a tracking URL is unreadable and you want to know what it is really doing.",
    icon: "Link",
    keywords: ["url", "decode", "unescape", "uri", "percent", "query string", "parameters"],
    route: "/tools/developer/url-decoder",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-19",
    actionLabel: "Decode",
    features: [
      "Whole-URL decode and component-by-component breakdown",
      "Query parameters listed as decoded name/value pairs",
      "Handles + as a space in query context",
      "Invalid escape sequences reported with their position",
      "Copy any individual component",
    ],
    howItWorks: [
      "Paste a URL or an encoded string.",
      "Decode.",
      "Read the component breakdown, and copy the pieces you need.",
    ],
    faq: [
      {
        question: "What is the difference between decodeURI and decodeURIComponent?",
        answer:
          "decodeURIComponent decodes an entire string as one component. decodeURI leaves reserved characters alone so that a whole URL survives the round trip. When you are reading a single query value, you want the component behaviour.",
      },
      {
        question: "Why does my string turn into gibberish?",
        answer:
          "It is almost certainly Base64 or a query string that has been decoded twice, or a string that was never URL-encoded in the first place. Decoding is only reversible if the original was encoded, so if the input was already plain text this produces noise by design.",
      },
      {
        question: "Does it turn + into a space?",
        answer:
          "In a query string, yes - a + means a space there, and that is what it decodes to. A + in a path or fragment is a literal plus sign and is left alone, because the two contexts mean different things.",
      },
    ],
    related: ["url-encoder", "jwt-decoder", "base64-decoder"],
  },
  {
    id: "uuid-generator",
    name: "UUID Generator",
    slug: "uuid-generator",
    category: "developer",
    description: "Generate cryptographically random UUID v4 values in bulk, with uppercase, hyphen-free and CSV export options.",
    intro:
      "UUID v4 values from the browser's cryptographic random source, not Math.random. Up to a thousand at a time, exportable as text or CSV.",
    icon: "Dices",
    keywords: ["uuid", "guid", "random", "unique id", "v4", "identifier", "ulid"],
    route: "/tools/developer/uuid-generator",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-26",
    actionLabel: "Generate",
    features: [
      "UUID v4 from crypto.getRandomValues, not Math.random",
      "1 to 1000 values per run",
      "Uppercase and hyphen-free variants",
      "Copy all, or download as .txt or .csv",
      "Regenerate the whole batch in one click",
    ],
    howItWorks: [
      "Choose how many you need.",
      "Generate.",
      "Copy the list or download it.",
    ],
    faq: [
      {
        question: "Are these unique?",
        answer:
          "UUID v4 draws 122 bits from a cryptographically secure source. Collisions are not impossible in the mathematical sense, but they are far less likely than a sequential scan finding the same value twice. Do not use UUIDs where you need ordering — they are random, not sortable by time.",
      },
      {
        question: "Why no sequential or time-based option?",
        answer:
          "Because they leak information. A sequential UUID reveals how many records exist, and a time-based one reveals when each was created. If you need ordering, use a database sequence or a dedicated ULID/ULID-style scheme.",
      },
      {
        question: "Are these suitable as database keys?",
        answer:
          "Yes, and they are a good default. They are 128 bits of randomness, so they do not collide in practice and they are safe to create on several machines at once - unlike a counter, which needs coordination.",
      },
    ],
    related: ["hash-generator", "timestamp-converter", "api-tester", "base64-encoder"],
  },
  {
    id: "hash-generator",
    name: "Hash Generator",
    slug: "hash-generator",
    category: "developer",
    description: "Hash text or a file with MD5, SHA-1, SHA-256, SHA-512, SHA3, BLAKE2 and CRC32, showing hex and Base64 with real timing.",
    intro:
      "Digest a string or an entire file. SHA-family hashes use the Web Crypto API; MD5, BLAKE2 and CRC32 come from a small audited library loaded on demand.",
    icon: "Hash",
    keywords: ["hash", "md5", "sha1", "sha256", "sha512", "checksum", "digest", "crc32", "blake2", "hmac"],
    route: "/tools/developer/hash-generator",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-26",
    actionLabel: "Hash",
    features: [
      "MD5, SHA-1, SHA-256, SHA-384, SHA-512, SHA-512/256",
      "SHA3-256 and SHA3-512",
      "BLAKE2b-256 and BLAKE2s-256",
      "CRC32 for checksums",
      "Text or file input, hex and Base64 output, real digest timing",
    ],
    howItWorks: [
      "Type text or drop a file.",
      "Every algorithm is computed in parallel.",
      "Copy the digest you need.",
    ],
    faq: [
      {
        question: "Is MD5 safe to use?",
        answer:
          "For checksumming a file against accidental corruption, yes. For anything security-related, absolutely not — MD5 collisions are practical to produce. Use SHA-256 or BLAKE2 for anything an adversary could touch.",
      },
      {
        question: "Do you upload the file?",
        answer: "No. File hashing reads the file with the File API and digests it in the tab. Nothing is transmitted.",
      },
      {
        question: "Which algorithm should I pick?",
        answer:
          "SHA-256 for anything that must be reproducible across languages - file fingerprints, cache keys, integrity checks. MD5 and SHA-1 appear because they are still everywhere in older systems, not because they are a good choice for anything new: both are broken for security purposes and are collision-prone.",
      },
    ],
    related: ["uuid-generator", "base64-encoder", "jwt-decoder", "api-tester"],
  },
  {
    id: "jwt-decoder",
    name: "JWT Decoder",
    slug: "jwt-decoder",
    category: "developer",
    description: "Decode a JSON Web Token's header and payload, check expiry, and verify an HMAC signature against a secret you supply.",
    intro:
      "Inspect a JWT without sending it anywhere, and optionally verify an HS256/384/512 signature. Asymmetric verification is not attempted, and the tool says why.",
    icon: "Key",
    keywords: ["jwt", "token", "bearer", "decode", "auth", "oauth", "claims", "json web token"],
    route: "/tools/developer/jwt-decoder",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-26",
    actionLabel: "Decode",
    features: [
      "Header and payload decoded without any network call",
      "Standard claims explained: iss, sub, aud, exp, nbf, iat, jti",
      "Live expiry countdown",
      "HMAC signature verification for HS256, HS384 and HS512",
      "Constant-time comparison, so verification is not timing-leaky",
    ],
    howItWorks: [
      "Paste the token.",
      "Read the header, payload and claims.",
      "For an HMAC token, paste the secret to verify the signature.",
    ],
    faq: [
      {
        question: "What does decoding a JWT prove?",
        answer:
          "Nothing. A JWT is signed, not encrypted — anyone holding one can read it, and anyone can create one. Decoding only tells you what the claims say. To trust them, verify the signature, and to keep them private, do not put secrets in the payload.",
      },
      {
        question: "Why can't you verify RS256 or ES256?",
        answer:
          "Verifying an asymmetric signature needs the issuer's public key, and we have no way to know which key is correct — trusting one supplied in the same box as the token would prove nothing. Use HS256 if you control the signing, and verify asymmetric tokens with your provider's own tooling.",
      },
      {
        question: "Is my token sent anywhere?",
        answer: "No. Decoding and HMAC verification both happen in the tab, and the secret you paste is never stored or transmitted.",
      },
    ],
    related: ["base64-decoder", "url-decoder", "timestamp-converter", "api-tester"],
  },
  {
    id: "regex-tester",
    name: "Regex Tester",
    slug: "regex-tester",
    category: "developer",
    description: "Test a regular expression live with match highlighting, a full capture-group breakdown, a replace preview and a plain-English explanation.",
    intro:
      "Build and test a pattern with every match and named group spelled out, plus a description of what the pattern actually does.",
    icon: "Regex",
    keywords: ["regex", "regexp", "regular expression", "pattern", "test", "match", "grep"],
    route: "/tools/developer/regex-tester",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-26",
    actionLabel: "Test",
    features: [
      "Global, case-insensitive, multiline, dot-all and unicode flags",
      "Live highlighting of matches in the test string",
      "Every match listed with index, groups and named groups",
      "Replace preview with $1 backreference support",
      "Pattern explained in plain English, plus common snippets to insert",
    ],
    howItWorks: [
      "Enter a pattern and a test string.",
      "Toggle flags as needed.",
      "Read the match list, or preview the replacement.",
    ],
    faq: [
      {
        question: "What happens if my pattern is invalid?",
        answer:
          "You get a readable error naming the problem and roughly where it is, rather than a silent failure or a frozen tab.",
      },
      {
        question: "Is it safe to paste untrusted input?",
        answer:
          "A badly written pattern can backtrack catastrophically and hang the tab. The test string is capped and long-running matches are reported, so a pathological pattern cannot take the page down silently.",
      },
      {
        question: "How do I test a pattern against many lines?",
        answer:
          "Paste multiline text into the subject box and the tool reports a match count per line, with the captured groups shown. That is far more useful than matching against a single string when you are narrowing down a pattern.",
      },
    ],
    related: ["find-replace", "json-validator", "diff-checker"],
  },
  {
    id: "timestamp-converter",
    name: "Timestamp Converter",
    slug: "timestamp-converter",
    category: "developer",
    description: "Convert between Unix timestamps, seconds and milliseconds, ISO 8601, RFC 2822, .NET ticks, Excel dates and human-readable times.",
    intro:
      "Paste a timestamp or a date string and get every representation of the same moment at once, in your timezone and in UTC.",
    icon: "CalendarClock",
    keywords: ["timestamp", "epoch", "unix", "date", "time", "iso 8601", "convert time", "utc"],
    route: "/tools/developer/timestamp-converter",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-02",
    actionLabel: "Convert",
    features: [
      "Unix seconds and milliseconds, with auto-detection",
      "ISO 8601, RFC 2822, UTC, local time and a live relative form",
      ".NET ticks and Excel serial dates",
      "SQL AT TIME ZONE form for database queries",
      "Choose the display timezone",
    ],
    howItWorks: [
      "Paste a timestamp or a date string.",
      "Read every format at once.",
      "Copy whichever you need.",
    ],
    faq: [
      {
        question: "Seconds or milliseconds?",
        answer:
          "Almost all modern Unix timestamps are milliseconds — a 13-digit number — because JavaScript's Date works that way. A 10-digit number is seconds. The tool auto-detects, and shows you which it decided.",
      },
      {
        question: "Which timezone is used?",
        answer:
          "UTC by default, with the local offset shown alongside so you can see both. Timestamps are absolute points in time; the only ambiguity is which timezone you want to read them in, and the tool never hides that choice.",
      },
      {
        question: "How do I tell it which unit I have?",
        answer:
          "The second and millisecond columns show the same moment at each precision, so compare them against a value you already know. A number near 1.7 billion is a Unix second count, and the same magnitude with three extra digits is milliseconds - that comparison is usually faster than arithmetic.",
      },
    ],
    related: ["cron-generator", "jwt-decoder", "uuid-generator"],
  },
  {
    id: "cron-generator",
    name: "Cron Generator",
    slug: "cron-generator",
    category: "developer",
    description: "Build a cron expression from field controls, decode an existing one into plain English, and see the next ten run times.",
    intro:
      "Work out a crontab entry without counting commas. Set the fields, or paste an expression to have it explained, then check when it will actually fire.",
    icon: "Timer",
    keywords: ["cron", "crontab", "schedule", "job", "expression", "next run", "timer"],
    route: "/tools/developer/cron-generator",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-02",
    actionLabel: "Generate",
    features: [
      "Build a cron expression from plain field controls",
      "Paste an expression and get a human description",
      "Next 10 run times, computed for real",
      "Common presets: hourly, daily, weekly, monthly",
      "5-field and 6-field (with seconds) support",
    ],
    howItWorks: [
      "Set each field, or paste an expression to decode.",
      "Read the description and the upcoming run times.",
      "Copy the expression.",
    ],
    faq: [
      {
        question: "Which flavour of cron is this?",
        answer:
          "Standard Vixie cron, which is what Linux, most hosting panels and GitHub Actions use. Quartz, used by some Java schedulers, has different semantics for day-of-month and day-of-week and is not supported.",
      },
      {
        question: "In what timezone are the run times?",
        answer:
          "The preview uses your browser's local timezone and labels it as such. The cron expression itself carries no timezone — the scheduler applies one, and they disagree more often than people expect.",
      },
      {
        question: "Does it include the seconds field?",
        answer:
          "No. This is standard five-field cron - minute, hour, day of month, month, day of week - which is what every scheduler and platform cron uses. The six-field variant that starts with seconds belongs to Quartz and a few others, and is not what you want on a standard server.",
      },
    ],
    related: ["timestamp-converter", "api-tester", "diff-checker"],
  },
  {
    id: "color-picker",
    name: "Color Picker",
    slug: "color-picker",
    category: "developer",
    description: "Pick a colour with HEX, RGB, HSL, HSV, CMYK and OKLCH fields, check WCAG contrast, and extract a palette from an image.",
    intro:
      "A colour picker that also answers the question you actually have: does this pass contrast? Includes a palette extractor for images.",
    icon: "Palette",
    keywords: ["color", "colour", "picker", "hex", "rgb", "hsl", "palette", "contrast", "wcag", "eyedropper"],
    route: "/tools/developer/color-picker",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-02",
    actionLabel: "Pick a colour",
    features: [
      "Saturation and value square with a hue slider",
      "HEX, RGB, HSL, HSV, CMYK and OKLCH, all two-way bound",
      "Alpha channel support",
      "WCAG contrast ratio with a clear AA/AAA verdict",
      "Extract a palette from a dropped image",
    ],
    howItWorks: [
      "Click in the colour field, or paste a hex value.",
      "Check the contrast ratio against your background.",
      "Copy any format, or extract a palette from an image.",
    ],
    faq: [
      {
        question: "How is contrast calculated?",
        answer:
          "With the WCAG 2.1 relative luminance formula, which is what the accessibility guidelines specify. It is not an approximation of a formula — it is the formula. A ratio of at least 4.5 is AA for body text, 3 for large text; 7 is AAA for body text.",
      },
      {
        question: "Which format should I copy?",
        answer:
          "HEX for CSS and design tools, RGB for canvas and image work, HSL when you want to adjust brightness or saturation without losing the hue. All three are live at once, so you can see how a change in one affects the others.",
      },
      {
        question: "How is contrast calculated?",
        answer:
          "Using the WCAG relative luminance formula, which weights the green channel most because human vision is most sensitive to it. The ratio shown is the same one an accessibility checker uses, and the AA and AAA thresholds are marked so you can tell at a glance whether a pairing passes.",
      },
      {
        question: "Is HEX the same thing as RGB?",
        answer:
          "The same colour expressed two ways. HEX is what CSS uses and is easier to copy into a stylesheet; RGB is what canvas and image libraries want. Converting between them can round by one step per channel, so a value that should be exact may be off by one - invisible, and harmless, but worth knowing if you are comparing checksums.",
      },
    ],
    related: ["css-formatter", "image-metadata", "color-extractor"],
  },
  {
    id: "diff-checker",
    name: "Code Diff Checker",
    slug: "diff-checker",
    category: "developer",
    description: "Compare two pieces of code or text side by side, with line-level and word-level highlighting, change counts and per-language syntax colours.",
    intro:
      "Diff two blocks of text with unified or side-by-side views, word-level highlighting inside changed lines, and lightweight syntax colouring.",
    icon: "Diff",
    keywords: ["diff", "compare", "difference", "delta", "side by side", "changes", "unified diff"],
    route: "/tools/developer/diff-checker",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-09",
    actionLabel: "Compare",
    features: [
      "Unified and split views",
      "Line-level add, remove and change detection",
      "Word-level highlighting within changed line pairs",
      "Added, removed and changed counts",
      "Syntax colouring for common languages, with no external library",
    ],
    howItWorks: [
      "Paste the original into the left pane and the new version into the right.",
      "Read the diff, with unchanged lines optionally hidden.",
      "Step between changes with the keyboard.",
    ],
    faq: [
      {
        question: "Which diff algorithm is used?",
        answer:
          "A longest-common-subsequence line diff, which is what git's default algorithm is built on. It is exact and predictable, though on very large inputs it is slower than a heuristic diff — there is no such thing as a free lunch in diffing.",
      },
      {
        question: "Can I compare two files or folders?",
        answer:
          "Two texts at a time, which covers a file against a previous version and a branch against another. Comparing whole directory trees is a different job and needs the tools that do it well - diff, or your version control's own history view.",
      },
      {
        question: "Which diff algorithm is used?",
        answer:
          "A line-based longest-common-subsequence, which is what gives you readable output rather than one changed block. An edit is therefore attributed to the line it actually changed instead of to a whole region, so a one-character fix does not redraw fifty lines.",
      },
      {
        question: "Can it ignore whitespace?",
        answer:
          "Yes, and it is worth using when two files differ only in indentation - the kind of noise a formatter introduces. Turn it on and a purely cosmetic difference disappears, leaving only the lines that genuinely changed.",
      },
    ],
    related: ["text-diff", "javascript-formatter", "json-formatter", "sql-formatter"],
  },
  {
    id: "qr-generator",
    name: "QR Code Generator",
    slug: "qr-generator",
    category: "developer",
    description: "Generate a scannable QR code as PNG or SVG, with configurable size, margin, colours and error-correction level.",
    intro:
      "Create a QR code that actually scans. Size, margin, colours and error-correction level are all adjustable, and you can export SVG for print.",
    icon: "Scan",
    keywords: ["qr", "qrcode", "barcode", "generate", "scan", "svg", "png", "wifi qr"],
    route: "/tools/developer/qr-generator",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-02-09",
    actionLabel: "Generate",
    features: [
      "Real, scannable codes generated locally",
      "Error-correction levels from L to H",
      "Configurable size, margin and colours",
      "Download as PNG, or copy the SVG source for print",
      "Warns when content is dense enough to scan unreliably",
    ],
    howItWorks: [
      "Enter a URL or any text.",
      "Adjust size, margin and error correction if needed.",
      "Download the PNG, or copy the SVG for print work.",
    ],
    faq: [
      {
        question: "Will this scan reliably?",
        answer:
          "For a short URL or a few dozen characters, yes, and you can check it with your phone before you print anything. As content grows the code gets denser and needs more physical size to scan. The tool warns you when that happens rather than letting you print something that will not work.",
      },
      {
        question: "Why use error correction?",
        answer:
          "It lets the code survive a small amount of damage — a logo covering part of it, a sticker scuff, a screen in poor light. Level H tolerates roughly 30% damage but produces a denser code. L is the most compact and the most fragile.",
      },
      {
        question: "What size should I print it at?",
        answer:
          "At least a fifth of the width of whatever scans it, and never smaller than about 2cm on a side. A code that works on a phone screen at arm's length will fail on a printed page, because the scanner has far less to work with. Test on the actual object before committing to a print run.",
      },
    ],
    related: ["url-encoder", "base64-encoder", "image-metadata"],
  },
  {
    id: "api-tester",
    name: "API Tester",
    slug: "api-tester",
    category: "developer",
    description: "Send a real HTTP request from your browser and inspect the status, timing, headers and body — with generated cURL and fetch snippets.",
    intro:
      "A request inspector that fires from your browser, so it obeys CORS exactly as a fetch in your console would. It says so plainly rather than pretending the limits are not there.",
    icon: "Send",
    keywords: ["api", "http", "request", "rest", "fetch", "curl", "endpoint", "postman", "test api"],
    route: "/tools/developer/api-tester",
    processing: "local",
    status: "beta",
    addedOn: "2026-02-16",
    actionLabel: "Send request",
    features: [
      "All common methods with a query-parameter builder",
      "Header rows, and raw, JSON or form-encoded bodies",
      "Real status, timing, response size and headers",
      "Pretty-printed response with JSON, HTML and raw views",
      "Generates the equivalent cURL command and fetch code",
    ],
    howItWorks: [
      "Choose a method, enter the URL and add any headers.",
      "Send.",
      "Read the response, and copy the generated code for your own project.",
    ],
    faq: [
      {
        question: "Why does some request fail with a CORS error?",
        answer:
          "Because the request comes from your browser, not from a server, and the target has to opt in by sending Access-Control-Allow-Origin. A browser-based API tester cannot bypass this, and neither can a fetch in your console — only a server-side request can. The tool reports it as a CORS block rather than a generic failure, because that is the actual cause.",
      },
      {
        question: "Are my credentials stored?",
        answer:
          "No. Nothing you type is saved, logged or sent to us. Reload the page and it is gone. Do not paste a long-lived production token into any web tool, including this one.",
      },
      {
        question: "Why is it labelled beta?",
        answer:
          "Because a browser cannot send every header a native client can — Host, Origin and User-Agent are controlled by the browser — and cannot read cross-origin responses at all. Those are hard platform limits, not bugs, and they are listed in the interface.",
      },
    ],
    related: ["http-header-viewer", "jwt-decoder", "json-formatter", "regex-tester"],
  },
  {
    id: "http-header-viewer",
    name: "HTTP Header Viewer",
    slug: "http-header-viewer",
    category: "developer",
    description: "Inspect the headers a request really sends, and audit a pasted header block for RFC 7230 problems and missing security headers.",
    intro:
      "Two things: send a request to see the actual headers, or paste a raw header block to check it against the spec and see which security headers are missing.",
    icon: "Newspaper",
    keywords: ["http", "headers", "cors", "hsts", "csp", "security headers", "request", "response", "rfc 7230"],
    route: "/tools/developer/http-header-viewer",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-16",
    actionLabel: "Inspect",
    features: [
      "Send a request and see the headers that actually went out and came back",
      "Parse a pasted raw header block into a table",
      "Flags obsolete folding, duplicate and malformed headers",
      "Checks for HSTS, CSP, X-Content-Type-Options, Referrer-Policy and CORS",
      "Plain-English verdict per security header",
    ],
    howItWorks: [
      "Either send a request to a URL, or paste a raw header block.",
      "Read the table, and act on anything flagged.",
    ],
    faq: [
      {
        question: "Which headers does the browser let me see?",
        answer:
          "For a same-origin request, everything the server sent. For a cross-origin one, only the CORS-safelisted ones unless the server allows them — which is the same restriction the API Tester hits. The tool labels which case you are in rather than showing you an empty list and letting you wonder.",
      },
      {
        question: "Can this test my site's security headers?",
        answer:
          "Partly, and honestly. Sending a request to your own origin lets you see your real response headers, and the audit tells you what is missing. It cannot verify anything about how your server actually enforces them — for that you need a scanner that probes behaviour, not just headers.",
      },
      {
        question: "Why can I not see some headers?",
        answer:
          "The browser exposes a fixed set through its scripting API and hides the rest, which is a deliberate limit rather than a bug in this tool. Response headers and their values are shown as received; anything the browser does not surface cannot be read from a page at all.",
      },
    ],
    related: ["api-tester", "jwt-decoder", "url-decoder"],
  },
  {
    id: "markdown-to-html",
    name: "Markdown to HTML",
    slug: "markdown-to-html",
    category: "developer",
    description: "Convert Markdown to HTML with a live preview, raw HTML escaped by default, and optional standalone document export.",
    intro:
      "Markdown to HTML with HTML-escaping on by default, so pasted content cannot inject markup. The inline-HTML toggle is off, and stays guarded even when on.",
    icon: "ScrollText",
    keywords: ["markdown", "html", "convert", "md", "preview", "gfm", "readme"],
    route: "/tools/developer/markdown-to-html",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-16",
    actionLabel: "Convert",
    features: [
      "Headings, emphasis, code, lists, task lists, tables, blockquotes, rules, links, images",
      "Fenced code blocks with a language class",
      "HTML escaped by default — pasted content cannot inject markup",
      "Optional inline HTML, still stripping script, on* handlers and javascript: URLs",
      "Export a standalone document or copy the fragment",
    ],
    howItWorks: [
      "Paste or type your Markdown.",
      "Read the live preview.",
      "Copy the HTML, or download a complete document.",
    ],
    faq: [
      {
        question: "Why is raw HTML disabled by default?",
        answer:
          "Because Markdown frequently contains text pasted from elsewhere, and rendering that as raw HTML is a stored-XSS hole. Escaping is on by default and the preview reflects the sanitised output. The toggle exists for content you wrote yourself, and even then script tags, event handlers and javascript: URLs are removed.",
      },
      {
        question: "Does it support GFM tables and task lists?",
        answer: "Yes, along with strikethrough and autolinks.",
      },
      {
        question: "What happens to my links and images?",
        answer:
          "They become normal HTML anchor and img tags with your URLs left exactly as written. Nothing is rewritten to a CDN or a tracker, and relative paths are not touched, so the output works from wherever you put it.",
      },
    ],
    related: ["markdown-editor", "html-formatter", "json-formatter"],
  },
] as const;
