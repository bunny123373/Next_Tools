"use client";

/**
 * AI Chat — a multi-turn conversation, laid out like the ChatGPT composer.
 *
 * The layout is the familiar one on purpose — a centred column, your own
 * messages as right-aligned bubbles, the model's replies as full-width prose,
 * and the input pinned to the bottom with the send button inside it — because
 * that shape is what people already know how to drive. Enter sends, Shift+Enter
 * inserts a newline, the textarea grows to fit up to a point and then scrolls.
 *
 * The streaming is the other half, and it is the honest kind. The reply is
 * delivered as server-sent events and appended as each piece arrives, so the
 * text appears as it is written. There is no simulated typewriter, no
 * character-by-character animation and no percentage anywhere: time-to-first-
 * token is not knowable in advance, so the honest state while waiting is
 * "Writing…".
 *
 * The transcript is the browser's to own, and each turn resends the whole
 * conversation so the model has context. That is also why the route caps turn
 * count and total characters — an unbounded "conversation" would otherwise be an
 * unbounded request. Both counters appear as you approach the limit rather than
 * after you hit it.
 *
 * The transcript lives in this tab only. Nothing is stored server-side, and the
 * page says so, because "it remembers the conversation" is otherwise ambiguous
 * between "for this session" and "forever".
 */

import * as React from "react";
import {
  ArrowUp,
  Info,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
} from "lucide-react";
import { ToolShell, PrivacyNote } from "@/components/tools/ToolShell";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolError } from "@/components/tools/states";
import { Field, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import { getTool } from "@/lib/tools/registry";
import {
  AI_MAX_STREAM_CHARS,
  AI_MAX_STREAM_MESSAGES,
  AI_MAX_TURN_CHARS,
} from "@/lib/ai/schemas";
import type { Tool } from "@/lib/tools/types";
import { AiRequestError, streamChatTurn } from "./ai-client";
import { AiCheckingState, AiSetupState, useAiStatus } from "./useAiStatus";
import { MissingTool } from "./MissingTool";

/**
 * Registry line:
 *   "ai-chat": dynamic(() => import("./ai/AiChatWorkspace")),
 *
 * The tool object comes from the registry so there is exactly one source of
 * metadata, and a workspace takes no props — hence the guard above.
 */
const tool = getTool("ai-chat");

const SUGGESTIONS = [
  "Explain what a regular expression does, using one from real code",
  "Write a SQL query that finds duplicate emails in a users table",
  "What is the difference between a list and a tuple in Python?",
  "Draft a short apology for a support ticket I answered too quickly",
];

/** The composer grows to this height, then scrolls internally. */
const MAX_COMPOSER_ROWS = 8;
/**
 * Must equal `MAX_COMPOSER_ROWS * lineHeight + padding` (8 * 24 + 24). The
 * auto-grow effect writes this as an inline height while the `max-h` class caps
 * it in CSS; when the two disagree the textarea is clipped short of its own
 * scroll point.
 */
const MAX_COMPOSER_PX = MAX_COMPOSER_ROWS * 24 + 24;

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** True while this reply is still arriving. */
  streaming?: boolean;
  /** Set when the visitor stopped a reply early. */
  stopped?: boolean;
  /** Set when a reply failed. The partial text is kept and shown. */
  failed?: string;
}

let nextId = 0;

export default function AiChatWorkspace() {
  if (!tool) return <MissingTool id="ai-chat" />;
  return <ChatInterface tool={tool} />;
}

function ChatInterface({ tool }: { tool: Tool }) {
  const status = useAiStatus();

  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [persona, setPersona] = React.useState("");
  const [showSettings, setShowSettings] = React.useState(false);
  const [temperature, setTemperature] = React.useState(0.7);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const ready = status.state === "ready";
  const abortRef = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  /** The settled turns, which is what gets resent. A streaming turn is excluded. */
  const transcript = React.useMemo(
    () =>
      messages
        .filter((message) => !message.streaming && message.content.trim().length > 0)
        .map((message) => ({ role: message.role, content: message.content })),
    [messages],
  );

  const characters = transcript.reduce((sum, turn) => sum + turn.content.length, 0);
  // The route caps the *array length*, so every message counts, not just the
  // visitor's half of the exchange. Counting only user turns here would let the
  // UI enable Send for a request the server is going to reject.
  const messagesUsed = transcript.length;
  /** Regenerate needs a visitor turn to resend. */
  const hasUserTurn = messages.some((message) => message.role === "user");
  const nearMessageLimit = messagesUsed >= AI_MAX_STREAM_MESSAGES - 8;
  const nearCharLimit = characters >= AI_MAX_STREAM_CHARS * 0.8;
  const overBudget = characters > AI_MAX_STREAM_CHARS || messagesUsed >= AI_MAX_STREAM_MESSAGES;
  const canSend = ready && !busy && input.trim().length > 0 && !overBudget;

  /* -- follow the reply, but only while the reader is at the bottom ------- */
  const pinnedRef = React.useRef(true);

  React.useEffect(() => {
    const onScroll = () => {
      const distance =
        document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      pinnedRef.current = distance < 140;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  React.useEffect(() => {
    if (!pinnedRef.current) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Abort any in-flight stream on unmount, so navigating away does not leave
  // the provider generating a reply nobody will read.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  /* -- composer auto-grow ------------------------------------------------- */

  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_COMPOSER_PX)}px`;
  }, [input]);

  /* -- send --------------------------------------------------------------- */

  const send = React.useCallback(
    async (history: Message[], text: string) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const userMessage: Message = { id: (nextId += 1), role: "user", content: text };
      const replyId = (nextId += 1);
      const replyMessage: Message = { id: replyId, role: "assistant", content: "", streaming: true };

      // A trailing assistant turn is dropped and rebuilt, which is what makes
      // "regenerate" work: the old attempt goes, a new one starts.
      const base = history.filter((message) => message.id !== replyId);
      setMessages([...base, userMessage, replyMessage]);
      setBusy(true);
      setError(null);

      const outgoing = [...base, userMessage]
        .filter((message) => !message.streaming && message.content.trim().length > 0)
        .map((message) => ({ role: message.role, content: message.content }));

      try {
        await streamChatTurn(
          {
            messages: outgoing,
            ...(persona.trim() ? { system: persona.trim() } : {}),
            temperature,
            signal: controller.signal,
          },
          (delta) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === replyId ? { ...message, content: message.content + delta } : message,
              ),
            );
          },
        );
        setMessages((current) =>
          current.map((message) =>
            message.id === replyId ? { ...message, streaming: false } : message,
          ),
        );
      } catch (caught) {
        if (controller.signal.aborted) {
          // A stop is a user action, not a failure. Keep what arrived.
          setMessages((current) =>
            current.map((message) =>
              message.id === replyId ? { ...message, streaming: false, stopped: true } : message,
            ),
          );
          return;
        }
        const detail =
          caught instanceof AiRequestError
            ? caught.message
            : "Something went wrong on the way to the model. Try again in a moment.";
        setError(detail);
        toast.error("The model could not be reached", detail);
        setMessages((current) =>
          current.map((message) =>
            message.id === replyId ? { ...message, streaming: false, failed: detail } : message,
          ),
        );
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [persona, temperature],
  );

  const onSend = () => {
    const text = input.trim();
    if (!canSend) return;
    setInput("");
    pinnedRef.current = true;
    void send(messages, text);
  };

  const onStop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onRegenerate = () => {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser || busy) return;
    const cut = messages.indexOf(lastUser);
    pinnedRef.current = true;
    void send(messages.slice(0, cut), lastUser.content);
  };

  const onClear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    pinnedRef.current = true;
  };

  const markdown = React.useMemo(
    () =>
      messages
        .filter((message) => message.content.trim().length > 0)
        .map((message) =>
          message.role === "user"
            ? `**You:**\n\n${message.content}`
            : `**Assistant:**\n\n${message.content}`,
        )
        .join("\n\n---\n\n"),
    [messages],
  );

  const empty = messages.length === 0;

  return (
    // `overflow-visible` deliberately overrides ToolShell's `flush`
    // `overflow-hidden`. An `overflow: hidden` ancestor is a scroll container,
    // so a `position: sticky` composer inside it resolves against THAT box
    // rather than the viewport — and since the box does not scroll, the
    // composer simply scrolled away instead of staying pinned. This is the
    // whole reason the ChatGPT-style pinned composer appeared not to work.
    <ToolShell flush className="overflow-visible">
      <div className="flex min-h-[70vh] flex-col">
        {status.state === "checking" ? (
          <div className="p-4 sm:p-6">
            <AiCheckingState />
          </div>
        ) : status.state === "unavailable" ? (
          <div className="p-4 sm:p-6">
            <AiSetupState tool={tool} reason={status.reason} />
          </div>
        ) : (
          <>
            <PrivacyNote mode="ai" detailed className="m-4 sm:m-6" />

            {error ? (
              <div className="px-4 sm:px-6">
                <ToolError title="That message could not be sent." detail={error} />
              </div>
            ) : null}

            {/* Transcript, centred like the composer. ---------------------- */}
            <div className="flex-1">
              {empty ? (
                <div className="flex flex-col items-center justify-center px-4 pt-10 pb-2 text-center sm:pt-16">
                  <h2 className="text-[26px] font-semibold tracking-tight text-[var(--text-ink)] sm:text-[30px]">
                    How can I help?
                  </h2>
                  <p className="mt-2 max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
                    Answers are written by a third-party language model and stream in word by word.
                    Nothing is saved after you close this page.
                  </p>
                </div>
              ) : (
                <ol className="mx-auto w-full max-w-[768px] px-4 pb-2 sm:px-6">
                  {messages.map((message) => (
                    <li
                      key={message.id}
                      className={cn(
                        "py-4",
                        message.role === "user" && "flex justify-end",
                      )}
                    >
                      {message.role === "user" ? (
                        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] bg-[var(--surface-card-2)] px-4 py-2.5 text-[15px] leading-relaxed text-[var(--text-ink)] sm:max-w-[75%]">
                          {message.content}
                        </div>
                      ) : (
                        <AssistantMessage
                          content={message.content}
                          streaming={message.streaming === true}
                          stopped={message.stopped === true}
                          failed={message.failed}
                        />
                      )}
                    </li>
                  ))}
                  <div ref={endRef} />
                </ol>
              )}
            </div>

            {/* Composer — sticky to the bottom, send button inside. --------- */}
            <div className="sticky bottom-0 z-10 bg-gradient-to-t from-[var(--surface-card)] via-[var(--surface-card)] to-transparent pt-2">
              <div className="mx-auto w-full max-w-[768px] px-3 pb-3 sm:px-4 sm:pb-4">
                {nearMessageLimit || nearCharLimit ? (
                  <Notice
                    tone="warning"
                    icon={<Info className="size-4" />}
                    title="This conversation is getting long."
                    className="mb-2.5"
                  >
                    {formatNumber(messagesUsed)} of {AI_MAX_STREAM_MESSAGES} messages and{" "}
                    {formatNumber(characters)} of {formatNumber(AI_MAX_STREAM_CHARS)} characters
                    are in use. The whole thread is sent on every message, so a very long
                    conversation slows down and eventually costs more. Clearing it keeps
                    everything in reach of the model&apos;s context.
                  </Notice>
                ) : null}

                <div
                  className={cn(
                    "rounded-[26px] border bg-[var(--surface-card)] transition-colors",
                    "focus-within:border-brand-500",
                    overBudget ? "border-amber-500/50" : "border-[var(--surface-line)]",
                  )}
                >
                  <label htmlFor="ai-chat-input" className="sr-only">
                    Your message
                  </label>
                  <Textarea
                    id="ai-chat-input"
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    disabled={!ready || overBudget}
                    maxLength={AI_MAX_TURN_CHARS}
                    placeholder="Ask anything"
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        onSend();
                      }
                    }}
                    // The shared control paints a red border and ring on `focus:`
                    // and rounds to 10px. All three are cancelled here, using the
                    // same `focus:` variant — `focus-visible:` would not, being a
                    // different variant, and the ring drew a red rounded box that
                    // did not line up with the 26px composer around it. The
                    // container's `focus-within:` border is the only focus cue.
                    //
                    // 16px on a phone for the iOS zoom reason; 15px from `sm` up.
                    className="max-h-[216px] min-h-[52px] w-full resize-none rounded-none border-0 border-transparent bg-transparent px-4 pt-3.5 text-base leading-6 shadow-none hover:border-transparent focus:border-transparent focus:outline-none focus:ring-0 focus:ring-transparent focus:ring-offset-0 focus:shadow-none sm:text-[15px]"
                  />

                  <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
                    <button
                      type="button"
                      onClick={() => setShowSettings((current) => !current)}
                      aria-expanded={showSettings}
                      aria-label={showSettings ? "Hide settings" : "Show settings"}
                      title={showSettings ? "Hide settings" : "Persona and creativity"}
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
                        showSettings
                          ? "bg-[var(--surface-line)] text-[var(--text-ink)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]",
                      )}
                    >
                      <Settings2 className="size-[18px]" aria-hidden="true" />
                    </button>

                    <span className="min-w-0 truncate text-[12px] text-[var(--text-muted)]">
                      AI assistant
                    </span>

                    <div className="ml-auto flex items-center gap-1.5">
                      {messages.length > 0 ? (
                        <>
                          <IconAction
                            label="Regenerate the last reply"
                            onClick={onRegenerate}
                            disabled={busy || !hasUserTurn}
                            icon={<RefreshCw className="size-4" aria-hidden="true" />}
                          />
                          <IconAction
                            label="Clear the conversation"
                            onClick={onClear}
                            disabled={busy}
                            icon={<Trash2 className="size-4" aria-hidden="true" />}
                          />
                        </>
                      ) : null}

                      {busy ? (
                        <button
                          type="button"
                          onClick={onStop}
                          aria-label="Stop generating"
                          title="Stop generating"
                          className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--text-ink)] text-[var(--surface-card)] transition-opacity hover:opacity-85"
                        >
                          <Square className="size-3" fill="currentColor" aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={onSend}
                          disabled={!canSend}
                          aria-label="Send message"
                          title="Send (Enter)"
                          className={cn(
                            "grid size-8 shrink-0 place-items-center rounded-full transition-all",
                            canSend
                              ? "bg-[var(--text-ink)] text-[var(--surface-card)] hover:opacity-85"
                              : "cursor-not-allowed bg-[var(--surface-line)] text-[var(--text-muted)]",
                          )}
                        >
                          <ArrowUp className="size-[18px]" strokeWidth={2.5} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {messages.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <CopyButton
                      value={markdown}
                      label="Copy conversation"
                      what="Conversation copied to clipboard"
                      size="sm"
                      variant="ghost"
                    />
                    <DownloadButton
                      size="sm"
                      variant="ghost"
                      text={markdown}
                      filename="ai-chat.md"
                      mime="text/markdown;charset=utf-8"
                      label="Download conversation"
                    />
                    <span className="ml-auto text-[11px] text-[var(--text-muted)]">
                      Enter to send · Shift+Enter for a new line
                    </span>
                  </div>
                ) : (
                  <ul className="mt-3 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((suggestion) => (
                      <li key={suggestion}>
                        <button
                          type="button"
                          onClick={() => {
                            setInput(suggestion);
                            textareaRef.current?.focus();
                          }}
                          className="rounded-full border border-[var(--surface-line)] px-3.5 py-2 text-left text-[12.5px] leading-snug text-[var(--text-muted)] transition-colors hover:border-brand-500 hover:text-[var(--text-ink)]"
                        >
                          {suggestion}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {showSettings ? (
                <div className="mx-auto w-full max-w-[768px] px-3 pb-4 sm:px-4">
                  <div className="flex flex-col gap-3.5 rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
                    <Field
                      label="Persona"
                      hint="Appended to the model's instructions. It can change the tone; it cannot switch the model off being honest about what it knows."
                    >
                      {({ id, describedBy }) => (
                        <Textarea
                          id={id}
                          aria-describedby={describedBy}
                          rows={2}
                          value={persona}
                          maxLength={2000}
                          disabled={busy}
                          placeholder="Be terse. Answer in Spanish. Explain like I'm new to this."
                          onChange={(event) => setPersona(event.target.value)}
                          // Same iOS zoom reason as the composer: the shared
                          // control is `text-sm` (14px), so 16px on a phone.
                          className="resize-y text-base sm:text-sm"
                        />
                      )}
                    </Field>

                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor="ai-chat-temperature"
                        className="flex items-baseline justify-between gap-3 text-[13px] font-medium text-[var(--text-ink)]"
                      >
                        <span>Creativity</span>
                        <span className="font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                          {temperature.toFixed(1)}
                        </span>
                      </label>
                      <input
                        id="ai-chat-temperature"
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={temperature}
                        disabled={busy}
                        onChange={(event) => setTemperature(Number(event.target.value))}
                        className="w-full accent-brand-500"
                      />
                      <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                        {temperatureLabel(temperature)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </ToolShell>
  );
}

/** A circular ghost button for the composer's secondary actions. */
function IconAction({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {icon}
    </button>
  );
}

function AssistantMessage({
  content,
  streaming,
  stopped,
  failed,
}: {
  content: string;
  streaming: boolean;
  stopped: boolean;
  failed?: string;
}) {
  const empty = content.length === 0;
  return (
    <div>
      <div
        className="whitespace-pre-wrap break-words text-[15px] leading-[1.75] text-[var(--text-ink)]"
        // A region so a screen reader hears the reply as it grows, not only
        // once it is complete.
        role="region"
        aria-label="Assistant reply"
        aria-busy={streaming}
      >
        {empty && streaming ? (
          <span className="text-[var(--text-muted)]">Writing…</span>
        ) : (
          content
        )}
      </div>
      {streaming && !empty ? (
        <span
          className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[2px] animate-pulse bg-[var(--text-ink)]"
          aria-hidden="true"
        />
      ) : null}
      {stopped ? (
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          Stopped early — this is only what arrived.
        </p>
      ) : null}
      {failed ? <p className="mt-1.5 text-[12px] text-amber-500">{failed}</p> : null}
      {!streaming && !stopped && !failed && !empty ? (
        <div className="mt-1.5">
          <CopyButton
            value={content}
            label="Copy reply"
            what="Reply copied to clipboard"
            size="sm"
            variant="ghost"
          />
        </div>
      ) : null}
    </div>
  );
}

function temperatureLabel(value: number): string {
  if (value < 0.3) return "Deterministic — the same question gets the same answer.";
  if (value < 0.8) return "Balanced. Reasonable variety without wandering off.";
  if (value < 1.3) return "Expressive — more variation, more risk of drifting.";
  return "Very high. Expect surprising answers and more of them that are wrong.";
}
