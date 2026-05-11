# agent-sdk-demo

[Claude Agent SDK](https://code.claude.com/docs/ja/agent-sdk/overview) を使ったコードレビュー Web アプリのデモ。

貼り付けた JavaScript / TypeScript / Python などのコードを、`Read` / `Glob` / `Grep` のみを許可した **読み取り専用エージェント** がレビューし、結果を NDJSON ストリームでリアルタイム表示します。

## 何が学べるか

| 観点 | デモでの見え方 |
|---|---|
| **エージェントループ** | tool_use → tool_result の自律的な繰り返しを SDK が肩代わり |
| **組み込みツール** | Read/Glob/Grep をゼロ実装で利用 |
| **権限制御** | `allowedTools` + `permissionMode: 'dontAsk'` で読み取り専用を強制 |
| **環境隔離** | `cwd` を一時ディレクトリに固定、`settingSources: []` でローカル設定の汚染を防止 |
| **ストリーミング** | thinking / tool_use / text / result イベントを Route Handler が NDJSON で配信 |
| **コスト可視化** | `total_cost_usd` を実行単位・累計で表示（USD / JPY 換算付き） |

## スタック

- Next.js 16 (App Router, Turbopack)
- React 19
- TypeScript 5
- Tailwind CSS v4
- [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) v0.2.x

## セットアップ

```bash
git clone https://github.com/Takashi-Matsumura/agent-sdk-demo.git
cd agent-sdk-demo
npm install
```

[Anthropic Console](https://platform.claude.com/) で API キーを取得し、`.env.local` に設定:

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local
```

開発サーバを起動:

```bash
npm run dev
```

`http://localhost:3000` を開き、コードを貼って「レビューを実行」をクリックします。

## API

| エンドポイント | 概要 |
|---|---|
| `POST /api/review` | `{ filename, code }` を受け取り、エージェントの進行を NDJSON で逐次ストリーミング |
| `GET /api/fx` | USD/JPY 為替レート（無料 API `open.er-api.com` を参照、1時間キャッシュ） |

### `POST /api/review` のイベント種別

```jsonc
{ "type": "status",   "message": "..." }                // 進行ステータス
{ "type": "system",   "message": "..." }                // セッション初期化など
{ "type": "thinking", "text": "..." }                   // モデルの内部推論
{ "type": "tool_use", "tool": "Read", "input": {} }     // ツール呼び出し
{ "type": "text",     "text": "..." }                   // モデル応答テキスト
{ "type": "result",   "result": "...",
  "total_cost_usd": 0.05, "num_turns": 4 }              // 完了 + コスト
{ "type": "error",    "message": "..." }
```

## エージェント設定の要点

`app/api/review/route.ts`:

```ts
for await (const msg of query({
  prompt: `Please review ${filename} in the current directory.`,
  options: {
    model: "claude-sonnet-4-6",
    cwd: workDir,                            // 一時ディレクトリに作業範囲を限定
    systemPrompt: REVIEW_PROMPT,             // 観点をカスタム指示
    allowedTools: ["Read", "Glob", "Grep"],  // 読み取り専用
    tools:        ["Read", "Glob", "Grep"],
    permissionMode: "dontAsk",               // 未承認ツールは即拒否
    settingSources: [],                      // ローカル設定を読み込まない
    maxTurns: 20,
  },
}))
```

## 費用感の目安

実行ごとに `total_cost_usd` を UI 上に円換算付きで表示します。為替レートは [open.er-api.com](https://open.er-api.com/) を 1 時間キャッシュ。1 ファイル数十行のレビューで概ね $0.03〜$0.10 程度（Sonnet 4.6 / 2026 年 5 月時点）。

## 今後の拡張アイデア

- `AskUserQuestion` ツールで Claude からの追加質問を UI で受け取る
- 複数ファイルアップロード対応
- システムプロンプト切り替え（セキュリティ重視 / TypeScript 特化 など）
- サブエージェントによる観点別レビューの並列実行
- Hooks (`PreToolUse` / `PostToolUse`) による監査ログ
- セッション再開による多ターン化（指摘の深掘り）

## ライセンス

[LICENSE](./LICENSE) を参照。Claude Agent SDK の利用は Anthropic の[商用利用規約](https://www.anthropic.com/legal/commercial-terms)に従います。
