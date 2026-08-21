/**
 * Chrome 内蔵 AI（Gemini Nano）の Prompt API の最小限の型定義。
 *
 * Prompt API はまだ TypeScript の標準型定義（lib.dom.d.ts）に含まれていないため、
 * このアプリで使用する範囲のみを自前で定義します。
 * 仕様: https://developer.chrome.com/docs/ai/prompt-api
 */

/**
 * モデルの可用性。
 *
 * - `unavailable`: この環境では利用不可
 * - `downloadable`: 利用可能だがモデルのダウンロードが必要
 * - `downloading`: モデルをダウンロード中
 * - `available`: すぐに利用可能
 */
export type LanguageModelAvailability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available'

/** session.prompt() のオプション */
export interface LanguageModelPromptOptions {
  /** 出力を制約する JSON Schema（構造化出力） */
  responseConstraint?: object
  /** 中断用シグナル */
  signal?: AbortSignal
}

/** LanguageModel.create() が返すセッション */
export interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>
  destroy(): void
}

/** LanguageModel.create() のオプション */
export interface LanguageModelCreateOptions {
  /** ダウンロード進捗などを監視するためのコールバック */
  monitor?: (monitor: EventTarget) => void
  /** システムプロンプトなどの初期メッセージ */
  initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[]
  /** 入力として想定する言語（ja/en など） */
  expectedInputs?: { type: 'text'; languages: string[] }[]
  /** 出力として想定する言語（ja/en など） */
  expectedOutputs?: { type: 'text'; languages: string[] }[]
}

/** グローバルに生える LanguageModel の静的インターフェース */
export interface LanguageModelStatic {
  availability(): Promise<LanguageModelAvailability>
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>
}

declare global {
  // Prompt API 対応ブラウザ（Chrome 138+）でのみ存在するグローバル変数
  // eslint-disable-next-line no-var
  var LanguageModel: LanguageModelStatic | undefined
}
