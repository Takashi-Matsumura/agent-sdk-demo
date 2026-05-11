"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MODEL } from "@/app/lib/config";

type Event =
  | { kind: "status"; text: string }
  | { kind: "system"; text: string }
  | { kind: "prompt"; role: "system" | "user"; text: string }
  | { kind: "tool"; tool: string; input: unknown }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "result"; text: string; cost: number; turns: number }
  | { kind: "warn"; text: string }
  | { kind: "error"; text: string };

type FxRate = {
  rate: number;
  asOf: string;
};

const SAMPLE = `function fetchUser(id) {
  const res = fetch("/api/users/" + id);
  return res.then(r => r.json());
}

function getUserName(id) {
  const user = fetchUser(id);
  return user.name;
}
`;

export default function Home() {
  const [filename, setFilename] = useState("snippet.js");
  const [code, setCode] = useState(SAMPLE);
  const [events, setEvents] = useState<Event[]>([]);
  const [running, setRunning] = useState(false);
  const [fx, setFx] = useState<FxRate | null>(null);
  const [lastCostUsd, setLastCostUsd] = useState<number | null>(null);
  const [totalCostUsd, setTotalCostUsd] = useState(0);
  const [runCount, setRunCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/fx")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.rate === "number") {
          setFx({ rate: d.rate, asOf: d.asOf });
        }
      })
      .catch(() => {});

    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          if (typeof d.totalUsd === "number") setTotalCostUsd(d.totalUsd);
          if (typeof d.count === "number") setRunCount(d.count);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!running && !completed) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, running, completed]);

  const review = async () => {
    setEvents([]);
    setLastCostUsd(null);
    setCompleted(false);
    setRunning(true);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename, code }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => "");
        setEvents((e) => [
          ...e,
          { kind: "error", text: `HTTP ${res.status}: ${errBody || res.statusText}` },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.type === "usage") {
            if (typeof parsed.totalUsd === "number") setTotalCostUsd(parsed.totalUsd);
            if (typeof parsed.count === "number") setRunCount(parsed.count);
            continue;
          }
          const ev = toEvent(parsed);
          setEvents((prev) => [...prev, ev]);
          if (ev.kind === "result") {
            setLastCostUsd(ev.cost);
            setCompleted(true);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setEvents((e) => [...e, { kind: "error", text: (err as Error).message }]);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();
  const resetTotal = async () => {
    if (!confirm("累計利用料と履歴をすべて削除します。よろしいですか？")) return;
    await fetch("/api/usage", { method: "DELETE" }).catch(() => {});
    setTotalCostUsd(0);
    setRunCount(0);
    setLastCostUsd(null);
  };

  return (
    <div className="flex-1 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-start">
          <section className="flex flex-col gap-4 lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
            <header className="shrink-0">
              <h1 className="text-2xl font-semibold">Claude Agent SDK · コードレビュー</h1>
              <p className="text-sm text-zinc-500 mt-1">
                Read / Glob / Grep のみを許可した読み取り専用エージェントが、貼り付けたコードをレビューします。
              </p>
            </header>

            <div className="shrink-0">
              <CostPanel
                fx={fx}
                lastUsd={lastCostUsd}
                totalUsd={totalCostUsd}
                runCount={runCount}
                onReset={resetTotal}
              />
            </div>

            <div className="flex flex-col gap-3 lg:flex-1 lg:min-h-0">
              <div className="flex items-center gap-3 shrink-0">
                <label className="text-sm font-medium">ファイル名</label>
                <input
                  className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm w-64"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  disabled={running}
                />
                <span className="text-xs text-zinc-500">拡張子で言語を Claude に伝えます</span>
              </div>
              <textarea
                className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 font-mono text-sm h-72 lg:h-auto lg:flex-1 lg:min-h-0 resize-none"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={running}
                spellCheck={false}
              />
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={review}
                  disabled={running || !code.trim()}
                  className="rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {running ? "レビュー中…" : "レビューを実行"}
                </button>
                {running && (
                  <button
                    onClick={cancel}
                    className="rounded border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm"
                  >
                    中止
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold sticky top-0 bg-zinc-50 dark:bg-zinc-950 py-1 z-10">
              エージェントの動き
            </h2>
            <EventLegend />
            <div className="space-y-2">
              {events.length === 0 && (
                <p className="text-sm text-zinc-500">まだ実行されていません。</p>
              )}
              {events.map((ev, i) => (
                <EventRow
                  key={i}
                  ev={ev}
                  collapse={
                    completed &&
                    (ev.kind === "thinking" ||
                      ev.kind === "tool" ||
                      ev.kind === "text")
                  }
                />
              ))}
              <div ref={bottomRef} aria-hidden />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function CostPanel({
  fx,
  lastUsd,
  totalUsd,
  runCount,
  onReset,
}: {
  fx: FxRate | null;
  lastUsd: number | null;
  totalUsd: number;
  runCount: number;
  onReset: () => void;
}) {
  const lastJpy = lastUsd != null && fx ? lastUsd * fx.rate : null;
  const totalJpy = fx ? totalUsd * fx.rate : null;

  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-6 flex-wrap">
          <Stat
            label="今回の利用料"
            usd={lastUsd}
            jpy={lastJpy}
            emptyLabel="未実行"
          />
          <Stat
            label={`累計利用料 · ${runCount}回`}
            usd={totalUsd}
            jpy={totalJpy}
            emptyLabel="0"
            emphasize
          />
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500">
            {fx ? (
              <>
                為替: 1 USD = ¥{fx.rate.toFixed(2)}
                <br />
                <span className="text-[10px]">{fx.asOf}</span>
              </>
            ) : (
              "為替レート取得中…"
            )}
          </div>
          <button
            onClick={onReset}
            disabled={totalUsd === 0 && runCount === 0}
            className="mt-2 text-xs underline text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-40 disabled:no-underline"
          >
            履歴を削除
          </button>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
        モデル: <span className="font-mono text-zinc-700 dark:text-zinc-300">{MODEL}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  usd,
  jpy,
  emptyLabel,
  emphasize,
}: {
  label: string;
  usd: number | null;
  jpy: number | null;
  emptyLabel: string;
  emphasize?: boolean;
}) {
  const isEmpty = usd == null || usd === 0;
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      {isEmpty ? (
        <div className="text-lg text-zinc-400">{emptyLabel}</div>
      ) : (
        <div className={emphasize ? "text-lg font-semibold" : "text-lg"}>
          <span className="font-mono">${usd!.toFixed(4)}</span>
          {jpy != null && (
            <span className="ml-2 text-zinc-500 font-mono">
              （¥{jpy.toFixed(2)}）
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function toEvent(raw: Record<string, unknown>): Event {
  const t = raw.type as string;
  if (t === "status") return { kind: "status", text: String(raw.message ?? "") };
  if (t === "system") return { kind: "system", text: String(raw.message ?? "") };
  if (t === "prompt") {
    const role = raw.role === "user" ? "user" : "system";
    return { kind: "prompt", role, text: String(raw.text ?? "") };
  }
  if (t === "tool_use") {
    return { kind: "tool", tool: String(raw.tool ?? "?"), input: raw.input };
  }
  if (t === "text") return { kind: "text", text: String(raw.text ?? "") };
  if (t === "thinking") return { kind: "thinking", text: String(raw.text ?? "") };
  if (t === "result") {
    return {
      kind: "result",
      text: String(raw.result ?? ""),
      cost: Number(raw.total_cost_usd ?? 0),
      turns: Number(raw.num_turns ?? 0),
    };
  }
  if (t === "warn") return { kind: "warn", text: String(raw.message ?? "") };
  if (t === "error") return { kind: "error", text: String(raw.message ?? "") };
  return { kind: "system", text: JSON.stringify(raw) };
}

type BadgeStyle = {
  label: string;
  parent?: string;
  className: string;
};

function badgeFor(kind: Event["kind"], role?: "system" | "user"): BadgeStyle {
  switch (kind) {
    case "status":
      return {
        label: "status",
        className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
      };
    case "system":
      return {
        label: "system",
        className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
      };
    case "prompt":
      return {
        label: role === "user" ? "prompt" : "systemPrompt",
        parent: "input",
        className:
          role === "user"
            ? "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200"
            : "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
      };
    case "thinking":
      return {
        label: "thinking",
        parent: "assistant",
        className:
          "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
      };
    case "tool":
      return {
        label: "tool_use",
        parent: "assistant",
        className:
          "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
      };
    case "text":
      return {
        label: "text",
        parent: "assistant",
        className:
          "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
      };
    case "result":
      return {
        label: "result",
        className:
          "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
      };
    case "warn":
      return {
        label: "warn",
        className:
          "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
      };
    case "error":
      return {
        label: "error",
        className:
          "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
      };
  }
}

function Badge({
  kind,
  role,
}: {
  kind: Event["kind"];
  role?: "system" | "user";
}) {
  const b = badgeFor(kind, role);
  const title =
    kind === "prompt"
      ? role === "user"
        ? "SDK: query({ prompt: ... }) に渡した user メッセージ"
        : "SDK: options.systemPrompt に渡した system 指示"
      : b.parent
        ? `SDK: assistant.content[].type === "${b.label}"`
        : `SDK: message.type === "${b.label}"`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide ${b.className}`}
      title={title}
    >
      {b.parent && (
        <span className="opacity-60 normal-case tracking-normal">
          {b.parent} ▸
        </span>
      )}
      {b.label}
    </span>
  );
}

function EventLegend() {
  return (
    <details className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
      <summary className="cursor-pointer px-3 py-2 text-zinc-600 dark:text-zinc-400">
        SDK のメッセージ構造を見る
      </summary>
      <div className="px-3 pb-3 space-y-2 text-zinc-700 dark:text-zinc-300">
        <p>
          Agent SDK は <code className="font-mono">query()</code> から非同期に
          <strong> メッセージ</strong> を流します。各メッセージには
          <code className="font-mono"> type</code> があり、
          <code className="font-mono"> assistant</code> の中身は
          <strong> content ブロックの配列</strong> です。
        </p>
        <ul className="space-y-1.5 list-none">
          <li className="flex items-start gap-2">
            <Badge kind="prompt" role="system" />
            <span>
              <code className="font-mono">options.systemPrompt</code> に渡した指示。エージェントのレビュー観点・回答フォーマットなどを規定
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Badge kind="prompt" role="user" />
            <span>
              <code className="font-mono">query({"{ prompt }"})</code> に渡した最初の user メッセージ。レビュー対象の指定など
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Badge kind="system" />
            <span>セッション初期化など SDK 自体のイベント</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge kind="thinking" />
            <span>
              <code className="font-mono">assistant.content[]</code> の中の思考ブロック（最終出力には含まれない内部推論）
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Badge kind="tool" />
            <span>
              <code className="font-mono">assistant.content[]</code> のツール呼び出し（Read / Glob / Grep など）。SDK が自動実行して結果を次ターンに戻します
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Badge kind="text" />
            <span>
              <code className="font-mono">assistant.content[]</code> のテキスト発話（ユーザー向け）
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Badge kind="result" />
            <span>
              終端で 1 回だけ流れる集計メッセージ（コスト・ターン数・最終テキストの再掲）
            </span>
          </li>
        </ul>
        <p className="text-zinc-500">
          このアプリでは、assistant メッセージを 1 ブロックずつフラット化して NDJSON で配信しています（
          <code className="font-mono">app/api/review/route.ts</code> 参照）。
        </p>
      </div>
    </details>
  );
}

function plainPreview(text: string, max: number): string {
  const stripped = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[`*_#>\-\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > max ? stripped.slice(0, max) + "…" : stripped;
}

function EventRow({ ev, collapse }: { ev: Event; collapse?: boolean }) {
  const base = "rounded border px-3 py-2 text-sm";
  switch (ev.kind) {
    case "status":
    case "system":
      return (
        <div className={`${base} border-zinc-200 dark:border-zinc-800 text-zinc-500`}>
          <div className="flex items-center gap-2">
            <Badge kind={ev.kind} />
            <span>{ev.text}</span>
          </div>
        </div>
      );
    case "prompt": {
      const borderCls =
        ev.role === "user"
          ? "border-teal-200 dark:border-teal-900 bg-teal-50/50 dark:bg-teal-950/30"
          : "border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30";
      const previewCls =
        ev.role === "user"
          ? "text-teal-700 dark:text-teal-300"
          : "text-indigo-700 dark:text-indigo-300";
      return (
        <details className={`${base} ${borderCls}`}>
          <summary className="cursor-pointer flex items-center gap-2">
            <Badge kind="prompt" role={ev.role} />
            <span className={`text-xs ${previewCls}`}>
              {plainPreview(ev.text, 80)}
            </span>
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {ev.text}
          </pre>
        </details>
      );
    }
    case "tool":
      if (collapse) {
        return (
          <details className={`${base} border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950`}>
            <summary className="cursor-pointer flex items-center gap-2">
              <Badge kind="tool" />
              <span className="font-mono text-xs text-blue-700 dark:text-blue-300">
                {ev.tool}
              </span>
            </summary>
            <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-300">
              {JSON.stringify(ev.input, null, 2)}
            </pre>
          </details>
        );
      }
      return (
        <div className={`${base} border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950`}>
          <div className="flex items-center gap-2">
            <Badge kind="tool" />
            <span className="font-mono text-xs text-blue-700 dark:text-blue-300">
              {ev.tool}
            </span>
          </div>
          <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-300">
            {JSON.stringify(ev.input, null, 2)}
          </pre>
        </div>
      );
    case "thinking":
      if (collapse) {
        return (
          <details className={`${base} border-purple-200 dark:border-purple-900`}>
            <summary className="cursor-pointer flex items-center gap-2">
              <Badge kind="thinking" />
              <span className="text-xs text-purple-500 dark:text-purple-400 italic">
                {plainPreview(ev.text, 60)}
              </span>
            </summary>
            <div className="mt-1 whitespace-pre-wrap italic text-purple-700 dark:text-purple-300">
              {ev.text}
            </div>
          </details>
        );
      }
      return (
        <div className={`${base} border-purple-200 dark:border-purple-900 text-purple-700 dark:text-purple-300`}>
          <div className="flex items-center gap-2">
            <Badge kind="thinking" />
          </div>
          <div className="mt-1 whitespace-pre-wrap italic">{ev.text}</div>
        </div>
      );
    case "text":
      if (collapse) {
        return (
          <details className={`${base} border-zinc-200 dark:border-zinc-800`}>
            <summary className="cursor-pointer flex items-center gap-2">
              <Badge kind="text" />
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {plainPreview(ev.text, 60)}
              </span>
            </summary>
            <div className="mt-2">
              <Markdown>{ev.text}</Markdown>
            </div>
          </details>
        );
      }
      return (
        <div className={`${base} border-zinc-200 dark:border-zinc-800`}>
          <div className="flex items-center gap-2 mb-2">
            <Badge kind="text" />
          </div>
          <Markdown>{ev.text}</Markdown>
        </div>
      );
    case "result":
      return (
        <div className={`${base} border-green-300 dark:border-green-900 bg-green-50 dark:bg-green-950`}>
          <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
            <Badge kind="result" />
            <span className="font-medium">
              完了 · {ev.turns} ターン · ${ev.cost.toFixed(4)}
            </span>
          </div>
          {ev.text && (
            <div className="mt-3 pt-3 border-t border-green-200 dark:border-green-900/50">
              <div className="text-xs text-green-700 dark:text-green-300 mb-2 font-medium">
                最終レビュー結果
              </div>
              <Markdown>{ev.text}</Markdown>
            </div>
          )}
        </div>
      );
    case "warn":
      return (
        <div className={`${base} border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300`}>
          <div className="flex items-center gap-2">
            <Badge kind="warn" />
            <span>{ev.text}</span>
          </div>
        </div>
      );
    case "error":
      return (
        <div className={`${base} border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300`}>
          <div className="flex items-center gap-2">
            <Badge kind="error" />
            <span>{ev.text}</span>
          </div>
        </div>
      );
  }
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-xl font-semibold mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-semibold mt-4 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1.5">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1">{children}</h4>,
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="my-3 border-zinc-300 dark:border-zinc-700" />,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-700 pl-3 my-2 text-zinc-600 dark:text-zinc-400">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 underline"
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const inline = !className?.includes("language-");
            if (inline) {
              return (
                <code
                  className="rounded bg-zinc-200/70 dark:bg-zinc-800 px-1 py-0.5 font-mono text-[0.85em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={`block font-mono text-xs whitespace-pre ${className ?? ""}`}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded bg-zinc-900 text-zinc-100 dark:bg-zinc-800 p-3">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-zinc-300 dark:border-zinc-700 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-zinc-300 dark:border-zinc-700 px-2 py-1">{children}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
