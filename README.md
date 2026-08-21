# それって英語？

英語禁止プレイ（英語禁止マイクラなど）をしている配信者向けの、日本語単語の英語判定サービスです。
「これって英語なん？」と思った単語を入力すると、その場で **アウト（英語）/ セーフ（英語じゃない）** を判定します。

判定はすべて **Chrome 内蔵の Gemini Nano（Prompt API）** がブラウザの中だけで実行します。
サーバーは不要で、入力した単語が外部に送られるのは英単語の実在チェック（[Free Dictionary API](https://dictionaryapi.dev/)）のみです。

## 機能

1. **英語由来判定** — Gemini Nano が単語の語源を `english / wasei_eigo / japanese / other_language` に分類し、元の英単語を推定します
2. **英単語の実在チェック** — Free Dictionary API で綴りが実在するか確認し、発音記号と定義も表示します。Free Dictionary API に接続できないときは予備辞書の [Datamuse API](https://www.datamuse.com/api/) へ自動フォールバックします（どちらを使ったかは結果画面に明示されます）
3. **英単語の解説** — Gemini Nano が意味・品詞・使われ方を日本語で解説します
4. **例文の生成** — Gemini Nano がその英単語を使った例文を日本語訳付きで 3 つ作ります
5. **判定履歴** — 過去の判定を localStorage に保存し（最大 100 件）、クリックで再表示できます

## 動作要件

- デスクトップ版 Chrome 138 以降
- Gemini Nano（Prompt API）が有効であること
  - `chrome://flags/#prompt-api-for-gemini-nano` → Enabled
  - `chrome://flags/#optimization-guide-on-device-model` → Enabled BypassPerfRequirement
  - Chrome を再起動
- 初回利用時にモデル（数 GB 程度）のダウンロードが必要です（アプリ内のボタンから実行できます）

## 開発

```bash
npm install
npm run dev         # 開発サーバー（http://localhost:5173）
npm test            # テスト（Vitest）
npm run type-check  # 型チェック（tsc -b）
npm run lint        # Lint（oxlint）
npm run build       # プロダクションビルド
```

## アーキテクチャ

完全クライアントサイドの SPA（Vite + React + TypeScript）です。

```
src/
├── types.ts               # ドメイン型（JudgeResult / HistoryEntry など）
├── lib/
│   ├── promptApi.ts       # Prompt API（LanguageModel）のグローバル型定義
│   ├── geminiNano.ts      # Gemini Nano ラッパー（語源判定・解説・例文の 3 タスク）
│   ├── dictionary.ts      # 辞書クライアント（Free Dictionary API → 失敗時 Datamuse）
│   ├── judge.ts           # 判定パイプラインのオーケストレーション（依存注入）
│   └── history.ts         # 判定履歴の localStorage 永続化
├── components/
│   ├── InputForm.tsx      # 単語入力（IME の変換確定 Enter で誤送信しない）
│   ├── ResultView.tsx     # 判定スタンプ + 解説・辞書定義・例文の表示
│   └── HistoryList.tsx    # 判定履歴の一覧
└── App.tsx                # モデル準備〜判定〜履歴の状態管理
```

判定の流れ: `語源判定（Gemini Nano）→ 辞書チェック（Free Dictionary API）→ 解説生成 → 例文生成` で、
判定結果は 3 種類です。

- `english`（アウト）: 英語由来かつ辞書に実在
- `not_english`（セーフ）: 日本語固有・他言語由来
- `not_in_dictionary`: 英語由来と推定されたが辞書に無い（和製英語の可能性）

## 実装上の工夫（実機検証に基づく）

Chrome のオンデバイスモデルは不安定な挙動があるため、以下の対策を入れています（2026-08-21 に macOS の Chrome で実機確認）。

- **`initialPrompts`（システムプロンプト）を使わない** — initialPrompts 付きの `create()` はモデル推論を伴い、モデルプロセスの状態によって無限にハングするため、指示は各プロンプトに自己完結で記述しています
- **prompt の 60 秒タイムアウト** — 推論がハングしたら `AbortSignal` で中断し、エラーとして表面化させます
- **セッション再作成リトライ** — 推論後にモデルプロセスがクラッシュして次の呼び出しが `kErrorUnknown` になることがあるため、失敗時は新しいセッションで同じプロンプトを 1 回だけ再試行します
- **語源判定は boolean ではなく enum 分類** — yes/no で聞くと小型モデルは true に偏り「もちもち」まで英語と誤判定したため、4 分類から選ばせる方式にして精度を改善しています

## 既知の制約

- **Free Dictionary API は不安定なことがあります** — 2026-08-21 時点でバックエンドが不安定な状態を観測しています（Cloudflare キャッシュにある単語は 200、キャッシュミス時は約 6 割が 502。キャッシュ回避リクエスト 10 回中 6 回失敗を実測）。このためメイン辞書の接続エラー・5xx 時のみ Datamuse API へフォールバックします（ユーザー承認済み）。フォールバック時は結果画面に「予備辞書（Datamuse）で確認しました」と明示し、発音記号（IPA）は表示されません。両方失敗した場合はエラーを明示して失敗します
- Gemini Nano は小型モデルのため、語源判定・解説の正確性は保証されません。配信のネタ程度の精度と考えてください
- 判定には 1 単語あたり数秒〜数十秒かかります（オンデバイス推論のため。2 回目以降はモデルがウォームアップされて速くなります）

## プライバシー

- 判定・解説・例文の生成はすべてブラウザ内（オンデバイス）で完結します
- 外部に送信されるのは、辞書チェックのための推定英単語（例: `control`）のみです（送信先は Free Dictionary API、接続できないときは予備の Datamuse API）
- 判定履歴はブラウザの localStorage にのみ保存されます
