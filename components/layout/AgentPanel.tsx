"use client";

/**
 * The floating assistant's chat panel.
 *
 * Loaded on demand by `FloatingAgent`, so nothing here reaches a page until
 * someone opens the bot.
 *
 * It reuses the same streaming route as the AI Chat tool rather than adding a
 * second backend, which means the two share one set of guards: rate limiting,
 * the 40-message and 64k-character transcript caps, and the persona being
 * appended to (never substituted for) the honesty prompt.
 *
 * The transcript lives in this component's state and nowhere else. It is not
 * persisted to `localStorage` and there is no server-side history, so a reload
 * starts a new conversation. That is stated in the panel rather than left for
 * the visitor to assume.
 */

import * as React from "react";
import { ArrowUp, RotateCcw, Sparkles, Square, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { streamChatTurn, type StreamChatInput } from "@/components/tools/workspaces/ai/ai-client";
import { AI_MAX_STREAM_CHARS, AI_MAX_STREAM_MESSAGES } from "@/lib/ai/schemas";
import { formatNumber } from "@/lib/utils/format";

const MAX_INPUT_CHARS = 4_000;
/** Rows the composer grows to before it scrolls. */
const MAX_COMPOSER_ROWS = 6;

interface Turn {
  id: number;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  stopped?: boolean;
  failed?: string;
}

let nextId = 0;

const GREETING =
  "Ask what any of the tools on this site does, whether one uploads your file, or what it needs from your browser. I can also answer general questions and work on text you paste.";

export function AgentPanel({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [pinned, setPinned] = React.useState(true);

  const transcript = React.useMemo(
    () =>
      turns
        .filter((turn) => !turn.streaming && turn.content.trim().length > 0)
        .map((turn) => ({ role: turn.role, content: turn.content })),
    [turns],
  );

  const characters = transcript.reduce((sum, turn) => sum + turn.content.length, 0);
  const overBudget = characters > AI_MAX_STREAM_CHARS || transcript.length >= AI_MAX_STREAM_MESSAGES;
  const canSend = !busy && input.trim().length > 0 && !overBudget;

  // Follow the reply only while the reader is at the bottom of the panel.
  const onScroll = React.useCallback(() => {
    const node = endRef.current?.parentElement;
    if (!node) return;
    setPinned(node.scrollHeight - node.scrollTop - node.clientHeight < 60);
  }, []);

  React.useEffect(() => {
    if (!pinned) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, pinned]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  React.useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    const max = 24 * MAX_COMPOSER_ROWS + 24;
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
  }, [input]);

  const send = React.useCallback(
    async (history: Turn[], text: string) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const userTurn: Turn = { id: (nextId += 1), role: "user", content: text };
      const replyId = (nextId += 1);
      const base = history.filter((turn) => turn.id !== replyId);

      setTurns([...base, userTurn, { id: replyId, role: "assistant", content: "", streaming: true }]);
      setInput("");
      setBusy(true);
      setPinned(true);

      const request: StreamChatInput = {
        messages: [...base, userTurn]
          .filter((turn) => !turn.streaming && turn.content.trim().length > 0)
          .map((turn) => ({ role: turn.role, content: turn.content })),
        temperature: 0.6,
        // This bot is offered site-wide, so it gets the site's real tool
        // inventory. Without it the greeting below would be a lie.
        withSiteContext: true,
        signal: controller.signal,
      };

      try {
        await streamChatTurn(request, (delta) => {
          setTurns((current) =>
            current.map((turn) =>
              turn.id === replyId ? { ...turn, content: turn.content + delta } : turn,
            ),
          );
        });
        setTurns((current) =>
          current.map((turn) => (turn.id === replyId ? { ...turn, streaming: false } : turn)),
        );
      } catch (caught) {
        if (controller.signal.aborted) {
          setTurns((current) =>
            current.map((turn) =>
              turn.id === replyId ? { ...turn, streaming: false, stopped: true } : turn,
            ),
          );
          return;
        }
        const detail =
          caught instanceof Error
            ? caught.message
            : "Something went wrong on the way to the model. Try again.";
        toast.error("The assistant could not be reached", detail);
        setTurns((current) =>
          current.map((turn) =>
            turn.id === replyId ? { ...turn, streaming: false, failed: detail } : turn,
          ),
        );
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [],
  );

  const onSend = () => {
    const text = input.trim();
    if (!canSend) return;
    setPinned(true);
    void send(turns, text);
  };

  const onRegenerate = () => {
    const lastUser = [...turns].reverse().find((turn) => turn.role === "user");
    if (!lastUser || busy) return;
    const cut = turns.indexOf(lastUser);
    setPinned(true);
    void send(turns.slice(0, cut), lastUser.content);
  };

  const onClear = () => {
    abortRef.current?.abort();
    setTurns([]);
  };

  const hasUserTurn = turns.some((turn) => turn.role === "user");

  return (
    <>
      <header className="flex items-center gap-2.5 border-b border-[var(--surface-line)] px-4 py-3">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-500/10"
          aria-hidden="true"
        >
          <Sparkles className="size-4 text-brand-500" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[var(--text-ink)]">Assistant</p>
          <p className="truncate text-[11px] text-[var(--text-muted)]">
            {busy ? "Writing…" : "Third-party model · this chat is not saved"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={turns.length === 0 || busy}
          aria-label="Clear the conversation"
          title="Clear"
          className="grid size-8 place-items-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the assistant"
          title="Close"
          className="grid size-8 place-items-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)]"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      {/* Messages ------------------------------------------------------- */}
      <div onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {turns.length === 0 ? (
          <div className="p-4">
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{GREETING}</p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {[
                "Which tools upload my file?",
                "What can I do with a PDF here?",
                "Do I need to sign up?",
              ].map((question) => (
                <li key={question}>
                  <button
                    type="button"
                    onClick={() => {
                      setInput(question);
                      inputRef.current?.focus();
                    }}
                    className="w-full rounded-lg border border-[var(--surface-line)] px-3 py-2 text-left text-[12.5px] text-[var(--text-muted)] transition-colors hover:border-brand-500 hover:text-[var(--text-ink)]"
                  >
                    {question}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="flex flex-col gap-3 p-4">
            {turns.map((turn) =>
              turn.role === "user" ? (
                <li key={turn.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[16px] bg-[var(--surface-card-2)] px-3.5 py-2 text-[13px] leading-relaxed text-[var(--text-ink)]">
                    {turn.content}
                  </p>
                </li>
              ) : (
                <li key={turn.id}>
                  <div
                    className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--text-ink)]"
                    role="region"
                    aria-label="Assistant reply"
                    aria-busy={turn.streaming === true}
                  >
                    {turn.content.length === 0 && turn.streaming ? (
                      <span className="text-[var(--text-muted)]">Writing…</span>
                    ) : (
                      turn.content
                    )}
                  </div>
                  {turn.streaming && turn.content.length > 0 ? (
                    <span
                      className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-[var(--text-ink)]"
                      aria-hidden="true"
                    />
                  ) : null}
                  {turn.stopped ? (
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      Stopped early — only what arrived.
                    </p>
                  ) : null}
                  {turn.failed ? (
                    <p className="mt-1 text-[11px] text-amber-500">{turn.failed}</p>
                  ) : null}
                </li>
              ),
            )}
            <div ref={endRef} />
          </ol>
        )}
      </div>

      {/* Composer -------------------------------------------------------- */}
      <div className="border-t border-[var(--surface-line)] p-3">
        <div className="rounded-[22px] border border-[var(--surface-line)] focus-within:border-brand-500">
          <label htmlFor="agent-input" className="sr-only">
            Your message
          </label>
          <textarea
            id="agent-input"
            ref={inputRef}
            rows={1}
            value={input}
            disabled={overBudget}
            maxLength={MAX_INPUT_CHARS}
            placeholder="Ask a question…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSend();
              }
            }}
            className="max-h-[150px] min-h-[44px] w-full resize-none border-0 bg-transparent px-3.5 pt-3 text-[13.5px] leading-6 text-[var(--text-ink)] shadow-none placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="flex items-center gap-1.5 px-2 pb-2">
            {hasUserTurn ? (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={busy}
                aria-label="Regenerate the last reply"
                title="Regenerate"
                className="grid size-7 place-items-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-card-2)] hover:text-[var(--text-ink)] disabled:opacity-40"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}

            <span className="ml-auto text-[11px] text-[var(--text-muted)]">
              {overBudget
                ? `Thread full (${formatNumber(transcript.length)}/${AI_MAX_STREAM_MESSAGES})`
                : ""}
            </span>

            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop generating"
                title="Stop"
                className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--text-ink)] text-[var(--surface-card)] hover:opacity-90"
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
                    ? "bg-[var(--text-ink)] text-[var(--surface-card)] hover:opacity-90"
                    : "cursor-not-allowed bg-[var(--surface-line)] text-[var(--text-muted)]",
                )}
              >
                <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-center text-[10.5px] leading-snug text-[var(--text-muted)]">
          Answers come from a third-party model and can be wrong.
        </p>
      </div>
    </>
  );
}
