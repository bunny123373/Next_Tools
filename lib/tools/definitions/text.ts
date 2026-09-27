import type { Tool } from "../types";

/**
 * Text tools.
 *
 * Every one of these is a pure string transform: nothing is uploaded, nothing
 * is stored, and every readout is recomputed from the text in front of you.
 */
export const TEXT_TOOLS: readonly Tool[] = [
  {
    id: "word-counter",
    name: "Word Counter",
    slug: "word-counter",
    category: "text",
    description:
      "Count words, characters, sentences and paragraphs as you type, with reading and speaking time plus a per-paragraph breakdown.",
    intro:
      "Paste an essay, a post or a chapter and watch the numbers move with every keystroke. Nothing is uploaded and nothing is stored — the counts are calculated in this tab.",
    icon: "Type",
    keywords: [
      "word count",
      "count words",
      "essay word limit",
      "character count",
      "paragraph count",
      "reading time",
      "text statistics",
      "words per paragraph",
    ],
    route: "/tools/text/word-counter",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-05",
    actionLabel: "Count",
    features: [
      "Words, characters with and without spaces, sentences and paragraphs in one strip",
      "Reading and speaking time calculated as you type, not after a button press",
      "A per-paragraph bar chart so you can see where a piece of writing bulges",
      "Most-used words report to check an article is not repeating itself",
      "No account, no upload, no history — the text never leaves the page",
    ],
    howItWorks: [
      "Type or paste your text into the left pane.",
      "Read the live totals and the per-paragraph bar chart below.",
      "Copy the word-frequency report or download the text when you are done.",
    ],
    faq: [
      {
        question: "How is a word counted?",
        answer:
          "A word is any run of characters containing at least one letter or number, separated by whitespace. So “don't” and “3.5” each count once, and “---” counts zero times.",
      },
      {
        question: "Are hyphens and slashes counted as words?",
        answer:
          "No. A token like “and/or” contains letters, so it counts as one word, not two. Only whitespace separates words.",
      },
      {
        question: "Is my text sent anywhere?",
        answer:
          "No. Every count is computed in your browser with a regular expression over the string in the editor. The page makes no network request with your text.",
      },
      {
        question: "How is reading time calculated?",
        answer:
          "At 200 words per minute, the commonly cited average for adults reading silently on a screen. Speaking time uses 130 words per minute, roughly a presentation pace.",
      },
    ],
    related: ["character-counter", "reading-time", "sentence-counter", "text-cleaner"],
  },

  {
    id: "character-counter",
    name: "Character Counter",
    slug: "character-counter",
    category: "text",
    description:
      "Count characters against a real limit — post, meta description, SMS or title tag — with live remaining counts, UTF-8 size and grapheme totals.",
    intro:
      "Most fields have a hard character limit, and most counters get the wrong one. This one shows the count you need, how much you have left, and what the text costs in bytes.",
    icon: "TextCursorInput",
    keywords: [
      "character counter",
      "character limit",
      "count characters",
      "tweet length",
      "meta description length",
      "sms characters",
      "utf-8 bytes",
      "grapheme count",
    ],
    route: "/tools/text/character-counter",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-05",
    actionLabel: "Count characters",
    features: [
      "Presets for a 280-character post, a 155-character meta description, an SMS and a title tag, plus your own limit",
      "Remaining characters turn amber as you approach the limit and red once you pass it",
      "Grapheme count, so an emoji or an accented letter counts as one character rather than two",
      "UTF-8 byte size, which is what actually matters for a database column or an upload",
      "A breakdown of where the characters go: letters, digits, punctuation and whitespace",
    ],
    howItWorks: [
      "Type into the editor, or paste from the clipboard.",
      "Pick the limit you are writing to — the meter updates on every keystroke.",
      "Copy the text out, or download it once the meter is in the green.",
    ],
    faq: [
      {
        question: "Why do I see three different character counts?",
        answer:
          "Characters is what you type, including spaces. Graphemes counts what a reader perceives as one symbol, so 👩‍👩‍👧‍👦 is one. UTF-8 bytes is the storage size, where a single emoji can be 4.",
      },
      {
        question: "Are limits for every platform the same?",
        answer:
          "No. The presets are the widely published limits for a short social post (280), a search-result description (around 155), a single SMS (160) and an HTML title tag (around 60). Your own limit can be typed in.",
      },
      {
        question: "Does a new line count as a character?",
        answer:
          "Yes — each line break is one character. The letters-and-punctuation breakdown reports whitespace separately so you can see how much of the count is layout.",
      },
      {
        question: "Is my text uploaded?",
        answer: "No. The counts run entirely in your browser and the text is never sent to a server.",
      },
    ],
    related: ["word-counter", "text-cleaner", "slug-generator", "markdown-editor"],
  },

  {
    id: "sentence-counter",
    name: "Sentence Counter",
    slug: "sentence-counter",
    category: "text",
    description:
      "Count sentences, average words per sentence, longest and shortest sentence, and get every sentence listed with long ones flagged.",
    intro:
      "Sentence length is one of the strongest readability signals there is. This counts the sentences, measures them, and lists them so you can see the run-ons.",
    icon: "TextQuote",
    keywords: [
      "sentence counter",
      "count sentences",
      "average sentence length",
      "readability",
      "longest sentence",
      "run-on sentence",
      "sentence list",
    ],
    route: "/tools/text/sentence-counter",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-05",
    actionLabel: "Count sentences",
    features: [
      "Sentence total with the average words per sentence beside it",
      "Longest and shortest sentence measured in words, with the longest quoted back",
      "Every sentence listed and numbered in reading order",
      "Sentences over 25 words flagged, the usual readability threshold",
      "Works on abbreviations such as “Dr.” and on trailing quotes without splitting a sentence in two",
    ],
    howItWorks: [
      "Paste the text you want to measure.",
      "Read the totals, then scan the numbered list for flagged long sentences.",
      "Copy the list or download the text.",
    ],
    faq: [
      {
        question: "How are sentences split?",
        answer:
          "A sentence ends at a full stop, exclamation mark, question mark or ellipsis, optionally followed by a closing quote or bracket. A final line without punctuation still counts.",
      },
      {
        question: "What counts as a long sentence?",
        answer:
          "More than 25 words. It is a rule of thumb for readability, not a law — a long sentence is fine when it is doing deliberate rhythmic work.",
      },
      {
        question: "Does “Dr.” break a sentence in two?",
        answer:
          "It can, because the counter has no abbreviation list. If that happens, the numbered list makes it obvious, and the average shows you why the number looks off.",
      },
      {
        question: "Is my text stored?",
        answer:
          "No. The analysis is done in the browser on each keystroke and nothing is written to a server or a database.",
      },
    ],
    related: ["word-counter", "reading-time", "character-counter", "text-cleaner"],
  },

  {
    id: "reading-time",
    name: "Reading Time Calculator",
    slug: "reading-time",
    category: "text",
    description:
      "How long does this take to read? Reading time at 150, 200 and 250 words per minute, speaking time at 130, and time-to-read per screen.",
    intro:
      "Paste anything from a tweet to a white paper and get a reading estimate at three speeds, a speaking estimate, and how long each screen of a page would take.",
    icon: "Timer",
    keywords: [
      "reading time",
      "reading time calculator",
      "words per minute",
      "speaking time",
      "how long to read",
      "blog post length",
      "screen time",
    ],
    route: "/tools/text/reading-time",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-05",
    actionLabel: "Calculate",
    features: [
      "Reading time at 150 wpm (careful), 200 wpm (average) and 250 wpm (fast)",
      "Speaking time at 130 wpm, the usual pace for reading aloud",
      "Time to read one, two, three or four screens, using 400 words as a screen",
      "Second-level precision, so a 90-second read is not rounded to “2 min”",
      "Word, sentence and paragraph counts alongside, so the estimate is checkable",
    ],
    howItWorks: [
      "Paste the text or drop it into the editor.",
      "Choose the reading speed that matches your reader.",
      "Read the estimate and the per-screen breakdown.",
    ],
    faq: [
      {
        question: "How is reading time worked out?",
        answer:
          "Words divided by words-per-minute. 200 wpm is the commonly cited average for adults reading silently on screen; 150 is careful reading, 250 is skimming.",
      },
      {
        question: "What counts as one screen?",
        answer:
          "400 words, a common rule of thumb for a full page of continuous prose. It is an assumption, not a measurement, which is why it is stated next to the number.",
      },
      {
        question: "Does the time include images or code?",
        answer:
          "No. It measures the words you provided. Add your own seconds for images, diagrams or code you cannot skim.",
      },
      {
        question: "Why is the estimate different from the number on another site?",
        answer:
          "Different sites use different speeds and different rounding. This one shows all three speeds at once so you can pick the assumption rather than inherit it.",
      },
    ],
    related: ["word-counter", "sentence-counter", "character-counter", "lorem-ipsum"],
  },

  {
    id: "case-converter",
    name: "Case Converter",
    slug: "case-converter",
    category: "text",
    description:
      "Convert text to UPPER, lower, Title, Sentence, camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, dot.case and more at once.",
    intro:
      "Paste the text once and read every casing at the same time. Title Case here keeps small words lowercase, leaves your acronyms alone, and handles hyphenated names properly.",
    icon: "CaseSensitive",
    keywords: [
      "case converter",
      "uppercase",
      "lowercase",
      "title case",
      "sentence case",
      "camelcase",
      "snake case",
      "kebab case",
      "constant case",
    ],
    route: "/tools/text/case-converter",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-12",
    actionLabel: "Convert",
    features: [
      "Thirteen casings computed at once and shown as a list you can click and copy",
      "Title Case that lowercases of/the/and, capitalises both halves of a hyphenated word, and preserves acronyms like NASA",
      "camelCase, snake_case, kebab-case, CONSTANT_CASE and dot.case all understand existing camel humps and digit boundaries",
      "Multi-line input is converted line by line, so your layout survives",
      "Alternating and inverse case for when you need a string to look different",
    ],
    howItWorks: [
      "Type or paste the source text.",
      "Click the casing you want in the list, or use the row of buttons above the output.",
      "Copy the result, or download it as a text file.",
    ],
    faq: [
      {
        question: "Why is “the” lowercase in Title Case?",
        answer:
          "Because that is the convention: articles, short prepositions and conjunctions stay lowercase unless they are the first or last word. “The Lord of the Rings”, not “The Lord Of The Rings”.",
      },
      {
        question: "Are acronyms preserved?",
        answer:
          "Yes. A token you typed in all caps, such as NASA or FBI, is recognised as an acronym and left as it is in Title Case. Sentence Case lowercases everything except sentence openings, so it is predictable.",
      },
      {
        question: "How does it split words that are already joined?",
        answer:
          "It honours camel humps, acronym boundaries and digit boundaries, so getHTTPResponseV2 becomes get_http_response_v2 in snake_case and getHTTPResponseV2 in PascalCase.",
      },
      {
        question: "What happens to a multi-line document?",
        answer:
          "Each line is converted separately, so paragraph breaks and line structure are preserved. Only the cases that join words would collapse a line into a single identifier.",
      },
    ],
    related: ["text-cleaner", "slug-generator", "find-replace", "word-counter"],
  },

  {
    id: "remove-duplicate-lines",
    name: "Remove Duplicate Lines",
    slug: "remove-duplicate-lines",
    category: "text",
    description:
      "Delete repeated lines from any list, keeping the first copy. Optional sort, case-insensitive matching, whitespace handling and blank-line rules.",
    intro:
      "Paste a list with repeats in it and get a clean copy back. You choose whether order matters, whether case matters, and what happens to blank lines.",
    icon: "SquareStack",
    keywords: [
      "remove duplicate lines",
      "dedupe list",
      "delete duplicate lines",
      "unique lines",
      "sort and dedupe",
      "duplicate rows",
    ],
    route: "/tools/text/remove-duplicate-lines",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-12",
    actionLabel: "Remove duplicates",
    features: [
      "Keeps the first occurrence so your original order is preserved",
      "Optional A–Z or Z–A sort of the unique lines",
      "Ignore case, so “Apple” and “apple” count as the same line",
      "Ignore surrounding whitespace, so indentation differences do not create false duplicates",
      "Blank lines handled separately, with runs collapsed to a single blank line",
      "A list of every line that was removed, with a count",
    ],
    howItWorks: [
      "Paste the list into the editor.",
      "Set the matching rules — case, whitespace, sorting and blank lines.",
      "Check the removed-lines report, then copy or download the result.",
    ],
    faq: [
      {
        question: "Which copy of a duplicate is kept?",
        answer:
          "The first one. Order is preserved, so a sorted list stays sorted and an ordered list keeps its sequence. If you would rather sort, turn sorting on.",
      },
      {
        question: "Do blank lines count as duplicates?",
        answer:
          "They are handled separately from content. A blank line is never treated as a copy of a word. Turn on “treat blank lines as one” to collapse runs to a single blank line and drop the ones at either end.",
      },
      {
        question: "What happens to blank lines when I sort?",
        answer: "They are dropped, because a blank line has no place in a sorted list. The removed count includes them.",
      },
      {
        question: "Is it case sensitive by default?",
        answer:
          "Yes — “Apple” and “apple” are different lines unless you tick “ignore case”. The same applies to surrounding spaces.",
      },
    ],
    related: ["text-sorter", "text-cleaner", "case-converter", "find-replace"],
  },

  {
    id: "text-cleaner",
    name: "Text Cleaner",
    slug: "text-cleaner",
    category: "text",
    description:
      "Clean up messy text with sixteen switchable operations: whitespace, control characters, HTML tags, URLs, emails, quotes and duplicate words.",
    intro:
      "Tick only the cleanups you want and watch the character count fall as you type. Every operation is independent, so you can always undo one and see the difference.",
    icon: "Wand2",
    keywords: [
      "text cleaner",
      "clean text",
      "remove extra spaces",
      "remove line breaks",
      "remove html tags",
      "remove urls",
      "remove email addresses",
      "whitespace cleanup",
    ],
    route: "/tools/text/text-cleaner",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-12",
    actionLabel: "Clean",
    features: [
      "Sixteen independent operations, grouped as whitespace, characters and strip-content",
      "Live count of characters removed, and a per-operation breakdown of what each one did",
      "Normalise CRLF and CR line endings to plain line feeds",
      "Strip zero-width characters, the byte-order mark and unprintable control codes",
      "Convert curly quotes and dashes to ASCII, and non-breaking spaces to real spaces",
      "Remove HTML tags, URLs, email addresses, duplicate words or empty lines",
    ],
    howItWorks: [
      "Paste the messy text — copied from a PDF, a CMS or a spreadsheet.",
      "Tick the cleanups you need; the output and the removed-character count update live.",
      "Copy or download the cleaned text.",
    ],
    faq: [
      {
        question: "Are the operations reversible?",
        answer:
          "No, and they do not have to be. That is the point: the original stays in the editor and the cleaned version is the output, so you can always go back to the source and change your mind.",
      },
      {
        question: "Does it remove HTML tags or the text inside them?",
        answer:
          "Only the tags. “<b>bold</b>” becomes “bold”. The tag removal runs before the URL and email passes, so a link inside an attribute disappears with its tag.",
      },
      {
        question: "Does “remove duplicate words” change meaning?",
        answer:
          "It collapses an immediately repeated word, so “the the cat” becomes “the cat”. It does not deduplicate a list, and it never crosses a sentence boundary. Leave it off for prose if that bothers you.",
      },
      {
        question: "What order do the operations run in?",
        answer:
          "A fixed order, shown in the list: line endings, then trimming, then character-level cleanups, then the strip passes. The per-operation breakdown tells you exactly what each step removed.",
      },
    ],
    related: ["case-converter", "remove-duplicate-lines", "character-counter", "find-replace"],
  },

  {
    id: "slug-generator",
    name: "Slug Generator",
    slug: "slug-generator",
    category: "text",
    description:
      "Turn a headline into a clean URL slug: choose the separator, strip accents, replace characters you name, and cap the length on a word boundary.",
    intro:
      "Type a title and get the URL path you would paste into your CMS, with the percent-encoded form beside it. Accented letters are folded, and the length cap cuts on a word boundary.",
    icon: "Link",
    keywords: [
      "slug generator",
      "url slug",
      "permalinks",
      "clean url",
      "accent removal",
      "seo slug",
      "url friendly",
    ],
    route: "/tools/text/slug-generator",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-19",
    actionLabel: "Generate slug",
    features: [
      "Hyphen, underscore or dot separators",
      "Optional lowercasing and optional accent stripping via Unicode normalisation",
      "Your own replacement map, one `from=to` pair per line",
      "Maximum length that cuts on a word boundary instead of mid-word",
      "Live URL preview plus the percent-encoded variant for non-Latin slugs",
      "Apostrophes are folded away, so “sibling's” does not become “sibling-s”",
    ],
    howItWorks: [
      "Paste the headline or page title.",
      "Choose the separator, length cap and any character replacements.",
      "Copy the slug, or download it for a batch of titles.",
    ],
    faq: [
      {
        question: "How are accents removed?",
        answer:
          "The text is decomposed with Unicode normalisation (NFD) and the combining marks are deleted, so “Crème Brûlée” becomes “creme-brulee”. Letters that are not Latin, such as Japanese or Cyrillic, are kept.",
      },
      {
        question: "What does the length cap cut on?",
        answer:
          "A word boundary. Words are dropped from the end until the slug fits, and if a single word is still too long it is hard-truncated. The readout tells you when a cap was applied.",
      },
      {
        question: "Why is there a percent-encoded version?",
        answer:
          "For a non-Latin slug it is the exact form that has to go in a URL. For pure ASCII slugs the two are identical, because every character in the slug is already URL-safe.",
      },
      {
        question: "Can I map characters myself?",
        answer:
          "Yes — one pair per line, from=to, so `& = and` turns “fish & chips” into “fish-and-chips”. Longer keys are applied before shorter ones.",
      },
    ],
    related: ["text-cleaner", "case-converter", "character-counter", "markdown-editor"],
  },

  {
    id: "lorem-ipsum",
    name: "Lorem Ipsum Generator",
    slug: "lorem-ipsum",
    category: "text",
    description:
      "Generate lorem ipsum or bacon ipsum placeholder copy by paragraph or exact total word count, as plain text or as HTML paragraphs.",
    intro:
      "A real Latin-derived placeholder corpus, not repeated noise, with a no-repeat mode so long drafts do not read like the same sentence over and over. Or bring your own word list.",
    icon: "Sparkles",
    keywords: [
      "lorem ipsum",
      "placeholder text",
      "dummy text",
      "bacon ipsum",
      "filler text",
      "mock content",
      "lorem generator",
    ],
    route: "/tools/text/lorem-ipsum",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-19",
    actionLabel: "Generate",
    features: [
      "Lorem ipsum (the classic Cicero-derived passage) and an original bacon-style corpus",
      "Or paste your own word list and get sentences built from it",
      "By paragraphs or by an exact total word count",
      "One to fifty paragraphs, with an optional “Lorem ipsum dolor sit amet” opening",
      "No-repeat mode drains the whole corpus before any sentence is used twice",
      "Plain text or HTML paragraphs, ready to paste into a template",
    ],
    howItWorks: [
      "Pick a corpus and set paragraphs or a total word count.",
      "Press Generate for a fresh draw, or let the controls do it for you.",
      "Copy the result, or download it as .txt or .html.",
    ],
    faq: [
      {
        question: "Is the text real lorem ipsum?",
        answer:
          "Yes — the lorem corpus is the standard public-domain passage derived from Cicero, so it looks and reads like the placeholder you have seen a thousand times. The bacon corpus is original mock-elegiac prose written for this tool.",
      },
      {
        question: "How does the no-repeat option work?",
        answer:
          "Sentences are drawn from a shuffled queue and the queue is only reshuffled once it is empty, so nothing appears twice until every other sentence has been used.",
      },
      {
        question: "Does the word count land exactly?",
        answer:
          "In total-words mode, yes: the last sentence is cut on a word boundary to hit the number you asked for. In per-paragraph mode each paragraph can overshoot by up to one sentence, because cutting prose mid-sentence reads badly.",
      },
      {
        question: "Is anything sent to a server?",
        answer: "No. The corpus ships with the page and the shuffling uses your browser's own random number generator.",
      },
    ],
    related: ["word-counter", "reading-time", "character-counter", "markdown-editor"],
  },

  {
    id: "markdown-editor",
    name: "Markdown Editor",
    slug: "markdown-editor",
    category: "text",
    description:
      "Write Markdown with a live preview, then copy or download the HTML. Pasted markup is escaped, so nothing you paste can inject a script.",
    intro:
      "Write on the left, watch the rendering on the right, and take the HTML with you. Every tag in your text is escaped before it renders, so a pasted script stays text.",
    icon: "ScrollText",
    keywords: [
      "markdown editor",
      "markdown preview",
      "md to html",
      "markdown to html",
      "convert markdown",
      "live preview",
      "export html",
    ],
    route: "/tools/text/markdown-editor",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-02-03",
    actionLabel: "Preview",
    features: [
      "Headings, bold, italic, strikethrough, inline code, links, images and autolinks",
      "Fenced code blocks with a language label, blockquotes, horizontal rules and hard line breaks",
      "Ordered, unordered and task lists, nested one level",
      "Escapes every raw HTML tag by default, so pasted content cannot inject markup",
      "Optional inline HTML for `<kbd>` and friends, still stripped of scripts, handlers and javascript: URLs",
      "Copy the HTML or download a complete .html document with a charset",
    ],
    howItWorks: [
      "Write Markdown on the left; the preview updates on the same keystroke.",
      "Toggle inline HTML only if you need it — the default is safe by construction.",
      "Copy the HTML or download it as a standalone document.",
    ],
    faq: [
      {
        question: "Is the preview safe with untrusted Markdown?",
        answer:
          "Yes. By default every tag character in your text is escaped before rendering, so a pasted <script> appears as text rather than executing. Links only keep an href when the scheme is http, https, mailto, tel or ftp.",
      },
      {
        question: "What does the inline HTML toggle let through?",
        answer:
          "Inline formatting tags only — a, b, em, strong, code, kbd, mark, span, img and friends. Script, style, iframe and other document-loading elements are removed with their contents, every on* handler is dropped, and style is never allowed.",
      },
      {
        question: "Does the download work offline?",
        answer:
          "Yes. The .html file is assembled in your browser, so it opens correctly from disk with no network access at all.",
      },
      {
        question: "Which Markdown syntax is supported?",
        answer:
          "ATX headings, emphasis, strikethrough, inline code, fenced code, blockquotes, lists including task lists, rules, links, images, autolinks and hard line breaks. Reference-style links and tables are not implemented.",
      },
    ],
    related: ["lorem-ipsum", "text-diff", "word-counter", "character-counter"],
  },

  {
    id: "text-diff",
    name: "Text Diff Checker",
    slug: "text-diff",
    category: "text",
    description:
      "Compare two texts line by line: added, removed and changed highlighting, word-level detail inside changed lines, and change-by-change navigation.",
    intro:
      "Paste the original on the left and the new version on the right. The comparison is a real Myers diff run in your browser, and the unified diff is there to paste into a review.",
    icon: "Diff",
    keywords: [
      "diff checker",
      "text compare",
      "compare two texts",
      "line diff",
      "unified diff",
      "find differences",
      "side by side comparison",
    ],
    route: "/tools/text/text-diff",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-03",
    actionLabel: "Compare",
    features: [
      "Side-by-side on a wide screen, unified on a narrow one, with a +/- gutter per line",
      "Word-level highlighting inside changed line pairs, so you see which words moved",
      "Ignore case and ignore whitespace options",
      "Previous and next change navigation, on buttons and on the keyboard",
      "Unified diff as plain text, ready to paste into a pull request",
      "A hard size cap with a clear message, because line diffing is the one slow operation here",
    ],
    howItWorks: [
      "Paste the original into the first box and the new version into the second.",
      "Set ignore case or ignore whitespace if the two only differ cosmetically.",
      "Step through the changes, or copy the unified diff.",
    ],
    faq: [
      {
        question: "How is the comparison done?",
        answer:
          "A Myers diff over the lines of each text, after the identical beginning and end are peeled off. It is the same idea git uses, computed in your browser.",
      },
      {
        question: "Why is there a size limit?",
        answer:
          "Comparing two multi-megabyte files is genuinely slow — the work grows with the square of how much differs. Past the limit the tool says so plainly instead of locking the tab, so compare big documents in sections.",
      },
      {
        question: "What is the difference between ignore case and ignore whitespace?",
        answer:
          "Ignore case treats “Word” and “word” as the same line, so a case-only edit disappears. Ignore whitespace collapses every run of spaces and tabs to a single space, so re-indentation disappears. They can be used together.",
      },
      {
        question: "Are my two documents uploaded?",
        answer: "No. Both texts stay in the page and the diff is computed locally.",
      },
    ],
    related: ["find-replace", "text-sorter", "markdown-editor", "remove-duplicate-lines"],
  },

  {
    id: "find-replace",
    name: "Find & Replace",
    slug: "find-replace",
    category: "text",
    description:
      "Find and replace text with a live match count, whole-word and regex modes, $1 backreferences, and every match highlighted in a preview.",
    intro:
      "Type what you are looking for and see the matches appear in your text before you change anything. An invalid pattern is reported in plain words, never as a crash.",
    icon: "ArrowLeftRight",
    keywords: [
      "find and replace",
      "search and replace",
      "regex replace",
      "replace all",
      "whole word replace",
      "text substitution",
      "capture group replace",
    ],
    route: "/tools/text/find-replace",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-03",
    actionLabel: "Replace",
    features: [
      "Live match count, and every match highlighted in a preview you can click through",
      "Match case, whole word only, and regular-expression mode",
      "$1 and $2 capture-group backreferences in the replacement",
      "Replace the first match or all of them, then keep working from the result",
      "Extract the matches, one per line, for a report or a spreadsheet",
      "Regex patterns that could freeze the browser are refused before they run",
    ],
    howItWorks: [
      "Paste the text, then type what to find.",
      "Turn on regex if you need it, and use $1 in the replacement for a capture group.",
      "Press Replace or Replace all, and check the highlighted matches to confirm.",
    ],
    faq: [
      {
        question: "How do capture groups work?",
        answer:
          "In regex mode, $1 in the replacement is the first group in parentheses and $2 the second — so finding (\\w+)@(\\w+) and replacing with $2/$1 rewrites jo@site as site/jo. Outside regex mode the replacement is literal, so a dollar sign stays a dollar sign.",
      },
      {
        question: "What happens with an invalid pattern?",
        answer:
          "You get a readable message in the output pane naming the problem, such as an unterminated group. Nothing throws, nothing reaches the console, and your text is untouched.",
      },
      {
        question: "Why was my pattern refused?",
        answer:
          "Because it contained a quantifier wrapped around another one, like (a+)+. Those patterns can hang a browser for minutes. The tool points at the shape and asks for a simpler one.",
      },
      {
        question: "Is the replacement undoable?",
        answer:
          "Your original text is still in the editor — the result is a separate pane. Press Reset result to throw the replacement away and start again from the source.",
      },
    ],
    related: ["text-diff", "text-cleaner", "case-converter", "remove-duplicate-lines"],
  },

  {
    id: "text-sorter",
    name: "Text Sorter",
    slug: "text-sorter",
    category: "text",
    description:
      "Sort lines, comma-separated values, words or a CSV column alphabetically, naturally, numerically, by length, shuffled or deduped.",
    intro:
      "A list in, a sorted list out. Comparison is locale-aware and digit-aware, so file10 lands after file9 — and the shuffle is seeded from your browser's random source, not a fixed number.",
    icon: "ListOrdered",
    keywords: [
      "sort lines",
      "alphabetise list",
      "sort text",
      "natural sort",
      "numeric sort",
      "shuffle list",
      "sort csv column",
      "dedupe and sort",
    ],
    route: "/tools/text/text-sorter",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-10",
    actionLabel: "Sort",
    features: [
      "Ascending, descending, numeric, natural, by length, reversed, shuffled, or dedupe-and-sort",
      "Scope: whole lines, comma-separated values, whitespace-separated words, or one CSV column",
      "Natural sort using the browser's locale-aware collator, so 2 comes before 10",
      "Optionally ignore a leading article — the, a or an — when comparing",
      "Case sensitivity and blank-line removal",
      "CSV rows keep their original quoting; only the row order changes",
    ],
    howItWorks: [
      "Paste the list into the editor.",
      "Choose what to sort, how to sort it, and whether case or articles matter.",
      "Shuffle as many times as you like, then copy or download the result.",
    ],
    faq: [
      {
        question: "What is the difference between ascending and natural?",
        answer:
          "Ascending compares text character by character, so “10” comes before “9”. Natural sort treats digit runs as numbers, so it gives you 2, 9, 10. Natural is what you usually want.",
      },
      {
        question: "Is the shuffle predictable?",
        answer:
          "No. It uses crypto.getRandomValues from your browser rather than a seeded generator, so each shuffle is a genuine random permutation and cannot be replayed from a fixed seed.",
      },
      {
        question: "How does CSV column sorting treat quotes?",
        answer:
          "The row is parsed so a quoted field containing a comma is treated as one value, and the row is re-emitted exactly as you typed it. Only the order of the rows changes.",
      },
      {
        question: "Are leading articles really ignored?",
        answer:
          "Only for the comparison, not in the output — “The Beatles” sorts under B but still reads “The Beatles” when you copy it. Ticking the option uses a, an and the.",
      },
    ],
    related: ["remove-duplicate-lines", "text-diff", "case-converter", "text-cleaner"],
  },
];
