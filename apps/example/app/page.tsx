"use client";

import { useEffect, useRef, useState } from "react";
import type { ContextFrame } from "@/src/sia/context-frame";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface CatalogView {
  modelDefault: string;
  tools: { id: string; description: string }[];
  skills: { skillId: string; name: string; description: string }[];
}

const SUGGESTIONS = [
  "What's the weather in Lisbon right now?",
  "What's a 20% tip on $84 split between 5 of us?",
  "What time is it in Tokyo?",
  "Help me write a short thank-you note to a colleague",
];

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [frame, setFrame] = useState<ContextFrame | null>(null);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/catalog");
      if (res.ok) setCatalog((await res.json()) as CatalogView);
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { answer?: string; frame?: ContextFrame; error?: string };
      if (data.error) {
        setMessages([...next, { role: "assistant", content: `⚠️ ${data.error}` }]);
      } else {
        setMessages([...next, { role: "assistant", content: data.answer ?? "" }]);
        if (data.frame) setFrame(data.frame);
      }
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `⚠️ ${String(err)}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <header className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Personal Assistant</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
            A simple AI agent with its own tools. Its <strong>skills catalog is empty for now</strong> —
            it will be filled later by SIA.
          </p>
        </div>
        <span className="self-start rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {catalog?.modelDefault ?? "…"}
        </span>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Chat */}
        <section className="flex min-h-[60vh] flex-col rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div ref={scrollRef} className="scroll-thin flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="flex flex-col gap-3 pt-6 text-center text-sm text-neutral-400">
                <p>Ask the assistant something. Try one of these:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-white"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === "user"
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-400 dark:bg-neutral-800">
                  thinking…
                </div>
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your assistant…"
              className="flex-1 rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Send
            </button>
          </form>
        </section>

        {/* Inspector + catalog */}
        <section className="flex flex-col gap-4">
          <Inspector frame={frame} />
          <CatalogCard catalog={catalog} />
        </section>
      </div>
    </div>
  );
}

function Inspector({ frame }: { frame: ContextFrame | null }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">What the agent did</h2>
        {frame && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              frame.outcome === "tool"
                ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {frame.outcome === "tool" ? `${frame.toolCalls.length} tool call(s)` : "answered directly"}
          </span>
        )}
      </div>
      {!frame ? (
        <p className="text-sm text-neutral-400">Send a message to see which tools the agent used.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {frame.toolCalls.length === 0 && (
            <p className="text-xs text-neutral-400">No tools used — answered from the model directly.</p>
          )}
          {frame.toolCalls.map((tc, i) => (
            <div key={i}>
              <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{tc.toolId}</div>
              <div className="font-mono text-xs text-neutral-500">{JSON.stringify(tc.args)}</div>
              <div className="mt-1 whitespace-pre-wrap rounded-lg bg-neutral-50 p-2 text-xs dark:bg-neutral-800/60">
                {tc.result}
              </div>
            </div>
          ))}
          <div className="flex justify-between border-t border-neutral-100 pt-2 text-xs text-neutral-400 dark:border-neutral-800">
            <span>{frame.steps} steps</span>
            {frame.tokens && <span>{frame.tokens.total} tokens</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogCard({ catalog }: { catalog: CatalogView | null }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-semibold">Capabilities</h2>
      <div className="mb-3">
        <div className="mb-1.5 text-xs uppercase tracking-wide text-neutral-400">
          Tools{catalog ? ` · ${catalog.tools.length}` : ""}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {catalog?.tools.map((t) => (
            <span
              key={t.id}
              title={t.description}
              className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
            >
              {t.id}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-neutral-400">
          Skills{catalog ? ` · ${catalog.skills.length}` : ""}
        </div>
        {catalog && catalog.skills.length === 0 ? (
          <p className="text-xs text-neutral-400">Empty for now — to be filled by SIA.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {catalog?.skills.map((s) => (
              <span
                key={s.skillId}
                title={s.description}
                className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
              >
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
