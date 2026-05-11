import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getTotals, insertRun } from "@/app/lib/db";
import { MODEL } from "@/app/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYSTEM_PROMPT = `You are a senior software engineer assisting with code-related tasks.

The current working directory contains one or more files the user wants you to work with.
Use the Read, Glob, and Grep tools to explore the files. Do NOT attempt to modify any files.

Always follow the user's instructions carefully and respond in Japanese with well-structured Markdown
(headings, lists, code blocks, tables as appropriate).
`;

const DEFAULT_PROMPT = (filename: string) =>
  `現在のディレクトリにある ${filename} をレビューしてください。バグ、可読性、命名、エラーハンドリング、セキュリティ、慣用表現の観点で、重要度付きで指摘してください。最後に良い点もまとめてください。`;

type ReviewRequest = {
  filename?: string;
  code?: string;
  prompt?: string;
};

export async function POST(request: Request) {
  let body: ReviewRequest;
  try {
    body = (await request.json()) as ReviewRequest;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const code = body.code?.trim();
  if (!code) {
    return new Response(JSON.stringify({ error: "code is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const filename = sanitizeFilename(body.filename) || "snippet.txt";
  const workDir = await mkdtemp(path.join(tmpdir(), "agent-review-"));
  const filePath = path.join(workDir, filename);
  await writeFile(filePath, code, "utf8");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const userPrompt =
          body.prompt?.trim() || DEFAULT_PROMPT(filename);
        send({ type: "prompt", role: "system", text: SYSTEM_PROMPT });
        send({ type: "prompt", role: "user", text: userPrompt });
        send({ type: "status", message: `レビュー開始: ${filename}` });

        for await (const msg of query({
          prompt: userPrompt,
          options: {
            model: MODEL,
            cwd: workDir,
            systemPrompt: SYSTEM_PROMPT,
            allowedTools: ["Read", "Glob", "Grep"],
            tools: ["Read", "Glob", "Grep"],
            permissionMode: "dontAsk",
            settingSources: [],
            maxTurns: 20,
          },
        })) {
          const persistFinish = forward(msg, send);
          if (persistFinish) {
            try {
              insertRun({
                filename,
                model: MODEL,
                cost_usd: persistFinish.cost_usd,
                num_turns: persistFinish.num_turns,
                duration_ms: persistFinish.duration_ms,
              });
              const totals = getTotals();
              send({
                type: "usage",
                count: totals.count,
                totalUsd: totals.total_usd,
              });
            } catch (e) {
              send({
                type: "warn",
                message:
                  "DB保存に失敗: " +
                  (e instanceof Error ? e.message : String(e)),
              });
            }
          }
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function sanitizeFilename(name: string | undefined): string | null {
  if (!name) return null;
  const base = path.basename(name);
  if (!/^[\w.\-]+$/.test(base)) return null;
  return base;
}

type FinishInfo = {
  cost_usd: number;
  num_turns: number;
  duration_ms: number | null;
};

function forward(
  msg: unknown,
  send: (e: Record<string, unknown>) => void,
): FinishInfo | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as {
    type?: string;
    message?: { content?: unknown[] };
    subtype?: string;
    result?: string;
    total_cost_usd?: number;
    num_turns?: number;
    duration_ms?: number;
  };

  if (m.type === "system" && m.subtype === "init") {
    send({ type: "system", message: "セッション初期化完了" });
    return null;
  }

  if (m.type === "assistant" && m.message?.content) {
    for (const block of m.message.content as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        send({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        send({
          type: "tool_use",
          tool: String(block.name ?? "unknown"),
          input: block.input ?? null,
        });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        send({ type: "thinking", text: block.thinking });
      }
    }
    return null;
  }

  if (m.type === "result") {
    const cost = m.total_cost_usd ?? 0;
    const turns = m.num_turns ?? 0;
    const duration = typeof m.duration_ms === "number" ? m.duration_ms : null;
    send({
      type: "result",
      subtype: m.subtype,
      result: m.result ?? "",
      total_cost_usd: cost,
      num_turns: turns,
    });
    if (m.subtype === "success") {
      return { cost_usd: cost, num_turns: turns, duration_ms: duration };
    }
  }
  return null;
}
