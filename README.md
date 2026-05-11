# agent-sdk-demo

[Claude Agent SDK](https://code.claude.com/docs/ja/agent-sdk/overview) の挙動を体験しながら学ぶためのプレイグラウンド Web アプリ。

`Read` / `Glob` / `Grep` のみを許可した **読み取り専用エージェント** に、ユーザーが書いたプロンプトで自由に指示を与え、`thinking` / `tool_use` / `text` / `result` といった SDK の構造をリアルタイムに可視化します。コードレビュー・セキュリティ監査・テスト設計などのサンプルプロンプトを切り替えて、**同じファイル・同じツールでも指示でエージェントの振る舞いがどう変わるか** を観察できます。

## 学習のポイント

このアプリは Agent SDK の中核概念を「画面上で観察できる」形に展開しています。以下のチェックリストを意識しながら触ると効果的です。

### 1. エージェントループは SDK が自動で回す

`query()` を 1 回呼ぶだけで、SDK が内部で「model → tool_use → tool_result → model → ...」のループを自動運転します。Anthropic Client SDK ではこのループを自分で書く必要がありますが、Agent SDK では `for await` で流れてくるメッセージを **眺めるだけ** です。

> 参照箇所: `app/api/review/route.ts:68-90` の `for await (const msg of query({...}))`

### 2. メッセージ階層を意識する（バッジで色分け）

SDK が流すメッセージには **2 つの階層** があります:

- **トップレベルの message.type**: `system` / `assistant` / `user` / `result` …
- **assistant.content[] の block.type**: `thinking` / `tool_use` / `text`

UI 右ペインの各行に表示されるバッジが、その行が SDK のどの位置に対応するかを示します。`assistant ▸ thinking` のような表記がそれです。畳まれた `<details>` の summary には先頭 60 文字のプレビューが表示されるので、開かなくても流れが追えます。

> 参照箇所: `app/page.tsx::badgeFor()` でバッジ定義、`EventLegend` で凡例

### 3. ツールは権限制御で安全に絞る

`allowedTools` / `tools` で利用可能ツールを限定し、`permissionMode: "dontAsk"` で未承認ツールを即拒否、`settingSources: []` でローカル `.claude/` 設定の汚染を防ぎ、`cwd` で作業範囲を一時ディレクトリに固定する — この 4 点で **読み取り専用のサンドボックス** を作っています。

> 参照箇所: `app/api/review/route.ts:72-78`

### 4. システムプロンプトと user プロンプトを分けて考える

`options.systemPrompt` はエージェントの「役割と制約」を定義し、`query({ prompt })` の引数は「個別タスクの指示」です。このアプリではこの 2 つを **ストリームの先頭で UI に流して可視化** しています（インディゴとティールのバッジ）。サンプルプロンプトを切り替えるとき、システムプロンプトは変えずに user プロンプトだけ変わる点に注目してください。

> 参照箇所: `app/api/review/route.ts:66-68` で2つの prompt をイベント送出

### 5. ストリームは NDJSON で薄く中継する

SDK の async iterator を Route Handler 内で受け取り、各メッセージを「UI に必要なフィールドだけ」に詰め替えて NDJSON 1 行ずつ流しています。SSE より実装が単純で、クライアント側は `getReader()` + `decoder.decode()` でパースするだけです。

> 参照箇所: `app/api/review/route.ts::forward()` で SDK message → NDJSON 変換、`app/page.tsx::review()` でパース

### 6. コスト・ターン数は `result` メッセージに集約

`result` は終端で 1 回だけ流れる集計メッセージで、`total_cost_usd` / `num_turns` / `duration_ms` / 最終 assistant テキスト（`result.result`）が入っています。UI は `result` 受信時に SQLite (`data/usage.db`) へ INSERT し、累計表示を更新します。

> 参照箇所: `app/api/review/route.ts::forward()` の result 分岐 + `app/lib/db.ts::insertRun()`

### 7. `result.result` は最終テキストの再掲

`result.result` は最後の `assistant.content[].text` と同じ内容なので **二重表示に注意**。本アプリでは完了後に過去の `text` 行を `<details>` で畳み、緑の `result` パネルで最終結果を強調表示する設計にしています。

> 参照箇所: `app/page.tsx::EventRow` の text / result ケース

---

## スタック

- Next.js 16（App Router, Turbopack）
- React 19
- TypeScript 5（strict）
- Tailwind CSS v4
- [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) v0.2.x
- `better-sqlite3`（実行履歴の永続化）
- `react-markdown` + `remark-gfm`（assistant 出力の整形表示）

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

`http://localhost:3000` を開き、サンプルプロンプトを選んで「エージェントを実行」をクリック。

## 画面の見方

```
┌─────────────────────────────┬──────────────────────────────────┐
│ 左ペイン（固定）              │ 右ペイン（スクロール）              │
│                              │                                    │
│ ・タイトル                    │ ▸ SDK のメッセージ構造を見る        │
│ ・利用料・累計・モデル名       │   （折りたたみ Legend）             │
│ ・ファイル名 + コード入力      │                                    │
│ ・プロンプト textarea          │ status / system / prompt /        │
│   ＋サンプル3種ボタン          │ assistant▸thinking / tool_use /   │
│ ・エージェント実行 / クリア    │ text / result …                    │
│                              │ （各行にバッジ + Markdown 整形）    │
└─────────────────────────────┴──────────────────────────────────┘
```

- **左ペインは sticky 固定**: 右をスクロールしても入力部は常に画面に残る
- **完了後の自動畳み込み**: 完了すると `thinking` / `tool_use` / `text` は `<details>` で畳まれ、緑の `result` パネル（最終回答）に焦点が当たる
- **クリアボタン**: 実行結果（events / 今回コスト）を初期化。累計利用料と DB 履歴は維持

## API

| エンドポイント | 概要 |
|---|---|
| `POST /api/review` | `{ filename, code, prompt? }` を受け取り、エージェントの進行を NDJSON で逐次ストリーミング。完了時に SQLite に INSERT |
| `GET /api/fx` | USD/JPY 為替レート（`open.er-api.com` を 1 時間キャッシュ）|
| `GET /api/usage` | 累計実行回数・累計コスト・直近 20 件 |
| `DELETE /api/usage` | 履歴を全削除 |

### NDJSON イベント種別（UI 側の `Event` 型）

| type | 由来 | 用途 |
|---|---|---|
| `prompt` (role: `system` \| `user`) | アプリ側が起動直前に発行 | エージェントへの入力を可視化 |
| `status` | アプリ側 | 「レビュー開始: foo.js」など進行通知 |
| `system` | SDK の `message.type === "system"` | セッション初期化など |
| `thinking` | `assistant.content[].type === "thinking"` | モデルの内部推論 |
| `tool_use` | `assistant.content[].type === "tool_use"` | ツール呼び出し |
| `text` | `assistant.content[].type === "text"` | ユーザー向けテキスト発話 |
| `result` | SDK の `message.type === "result"` | 終端の集計（cost / turns / 最終text）|
| `usage` | アプリ側が DB 保存後に発行 | UI の累計表示を即時更新 |
| `warn` / `error` | アプリ側 | DB 書込み失敗、API エラーなど |

## エージェント設定（中核コード）

`app/api/review/route.ts`:

```ts
for await (const msg of query({
  prompt: userPrompt,                       // ユーザーが入力したプロンプト
  options: {
    model: "claude-sonnet-4-6",
    cwd: workDir,                           // 一時ディレクトリに作業範囲を限定
    systemPrompt: SYSTEM_PROMPT,            // 役割と制約を定義
    allowedTools: ["Read", "Glob", "Grep"], // 読み取り専用
    tools:        ["Read", "Glob", "Grep"],
    permissionMode: "dontAsk",              // 未承認ツールは即拒否
    settingSources: [],                     // ローカル .claude/ 設定を読まない
    maxTurns: 20,                           // 暴走止め
  },
})) {
  forward(msg, send); // SDK message → NDJSON へ変換
}
```

## 永続化

`data/usage.db`（SQLite, WAL モード）に各実行を 1 行ずつ記録します。`data/` は `.gitignore` 済み。

```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  model TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  num_turns INTEGER NOT NULL,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## 費用感の目安

サンプルプロンプトで 1 ファイル数十行を処理して概ね **$0.03〜$0.08**（Sonnet 4.6 / 2026 年 5 月時点）。`total_cost_usd` を SQLite に蓄積し、累計と「N 回実行」を表示します。

## 試してみよう（実験ネタ）

学習を深めるための実験アイデア:

- **同じコードに 3 つのサンプルプロンプトを順に当てる**: tool_use の数、ターン数、コストがどう変わるかを観察。**system プロンプトは固定でも user プロンプトで挙動が大きく変わる** ことを体感
- **maxTurns を 3 に絞ってみる**: `app/api/review/route.ts` の `maxTurns: 20` を一時的に減らし、上限到達時のエージェントの振る舞いを確認
- **allowedTools を変えてみる**: `Grep` を抜くと、`thinking` の戦略がどう変わるか
- **設定不一致を作る**: `tools` には `Read` を入れ、`allowedTools` から外す → SDK の優先順位を観察
- **永続化を別ストアに**: `app/lib/db.ts` を Redis や PostgreSQL に差し替えてみる
- **複数ファイル対応**: 入力を zip に拡張して `workDir` に展開、`Glob` の使い方を観察

## 今後の拡張アイデア

- `AskUserQuestion` ツールで Claude からユーザーへの質問を UI で受ける
- システムプロンプト自体の編集 UI（現在は固定）
- サブエージェント（`agents` オプション）による観点別の並列レビュー
- `Hooks`（`PreToolUse` / `PostToolUse`）で監査ログ
- `resume` を使ったセッション継続で多ターン化

## ライセンス

[LICENSE](./LICENSE) を参照。Claude Agent SDK の利用は Anthropic の[商用利用規約](https://www.anthropic.com/legal/commercial-terms)に従います。
