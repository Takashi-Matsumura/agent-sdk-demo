import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYSTEM_PROMPT = `You are a senior software engineer doing a code review.

Review the file(s) in the current working directory. Focus on:
- Bugs and correctness issues
- Readability and naming
- Error handling
- Security concerns at a generic level (input validation, injection risk, secrets)
- Idiomatic improvements for the language used

Use the Read, Glob, and Grep tools to explore the code. Do NOT attempt to modify any files.

Respond in Japanese. Structure the final answer as:
1. 概要 (1-2行)
2. 指摘事項 (重要度: high/medium/low, ファイル名:行番号, 内容, 改善案)
3. 良い点
`;

type ReviewRequest = {
  filename?: string;
  code?: string;
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
        send({ type: "status", message: `レビュー開始: ${filename}` });

        for await (const msg of query({
          prompt: `Please review ${filename} in the current directory.`,
          options: {
            model: "claude-sonnet-4-6",
            cwd: workDir,
            systemPrompt: SYSTEM_PROMPT,
            allowedTools: ["Read", "Glob", "Grep"],
            tools: ["Read", "Glob", "Grep"],
            permissionMode: "dontAsk",
            settingSources: [],
            maxTurns: 20,
          },
        })) {
          forward(msg, send);
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

function forward(msg: unknown, send: (e: Record<string, unknown>) => void) {
  if (!msg || typeof msg !== "object") return;
  const m = msg as { type?: string; message?: { content?: unknown[] }; subtype?: string; result?: string; total_cost_usd?: number; num_turns?: number };

  if (m.type === "system" && m.subtype === "init") {
    send({ type: "system", message: "セッション初期化完了" });
    return;
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
    return;
  }

  if (m.type === "result") {
    send({
      type: "result",
      subtype: m.subtype,
      result: m.result ?? "",
      total_cost_usd: m.total_cost_usd ?? 0,
      num_turns: m.num_turns ?? 0,
    });
  }
}
