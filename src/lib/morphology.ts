/**
 * 日本語形態素解析クライアント（Yahoo!テキスト解析API）。
 *
 * ユーザーの入力を日本語の段階で形態素（パーツ）に分解するために使用します。
 * 複合語の分解（アルミサッシ → アルミ + サッシ）と、品詞情報による
 * 文章の検出（助詞・判定詞を含むか）を決定的に行うのが目的です。
 *
 * リクエストは Yahoo API を直接呼ばず、自前のプロキシ
 * （Cloudflare Worker: workers/morphology）を経由します。
 * Yahoo の Client ID を Worker のシークレットとして秘匿し、
 * クライアント配布物に含めないためです。
 *
 * Content-Type は CORS-safelisted な text/plain で送り、
 * preflight（OPTIONS）の往復を発生させないシンプルリクエストにします。
 */

/** 形態素解析プロキシ（Cloudflare Worker）のエンドポイント */
const MORPHOLOGY_PROXY_ENDPOINT = 'https://sorette-eigo-morphology.mtane0412.workers.dev/'

/** リクエストボディの上限バイト数（Yahoo!テキスト解析APIの制限が 4KB のため） */
const MAX_REQUEST_BYTES = 4096

/** 形態素解析の照会に失敗したことを表すエラー */
export class MorphologyApiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MorphologyApiError'
  }
}

/**
 * 形態素 1 つ分の情報。
 * 判定パイプラインで使う表記と品詞のみを保持します。
 */
export interface MorphToken {
  /** 形態素の表記（例: アルミ） */
  surface: string
  /** 品詞（例: 名詞、助詞、判定詞） */
  pos: string
}

/**
 * API のレスポンスから形態素の一覧を取り出して検証します。
 *
 * @throws {MorphologyApiError} result.tokens が無い、または要素の形が不正な場合
 */
function 形態素一覧として検証する(ボディ: unknown): MorphToken[] {
  const tokens =
    typeof ボディ === 'object' && ボディ !== null
      ? ((ボディ as Record<string, unknown>).result as Record<string, unknown> | undefined)
          ?.tokens
      : undefined
  if (
    Array.isArray(tokens) &&
    tokens.every(
      (トークン) =>
        Array.isArray(トークン) &&
        typeof トークン[0] === 'string' &&
        typeof トークン[3] === 'string',
    )
  ) {
    // トークンは [表記, 読み, 基本形, 品詞, 品詞細分類, 活用型, 活用形] の 7 要素
    return tokens.map((トークン) => ({ surface: トークン[0], pos: トークン[3] }))
  }
  throw new MorphologyApiError(
    `形態素解析APIのレスポンスが期待した形式ではありませんでした: ${JSON.stringify(ボディ).slice(0, 100)}`,
  )
}

/**
 * 日本語のテキストを形態素に分解します。
 *
 * @param text - 分解する日本語のテキスト
 * @throws {MorphologyApiError} ネットワークエラー、HTTP エラー、レスポンスが不正な場合（fail-fast）
 */
export async function analyzeMorphemes(text: string): Promise<MorphToken[]> {
  const リクエストボディ = JSON.stringify({
    id: '1',
    jsonrpc: '2.0',
    method: 'jlp.maservice.parse',
    params: { q: text },
  })
  // API の制限を超えるリクエストは送っても失敗するため、送信前に弾く
  if (new TextEncoder().encode(リクエストボディ).length > MAX_REQUEST_BYTES) {
    throw new MorphologyApiError(
      '入力が長すぎるため判定できません。短い単語で入力してください',
    )
  }

  let response: Response
  try {
    response = await fetch(MORPHOLOGY_PROXY_ENDPOINT, {
      method: 'POST',
      // preflight を発生させないため text/plain で送る（ファイル冒頭コメント参照）
      headers: { 'Content-Type': 'text/plain' },
      body: リクエストボディ,
    })
  } catch (cause) {
    throw new MorphologyApiError(
      '形態素解析API（Yahoo!テキスト解析）への接続に失敗しました',
      { cause },
    )
  }

  if (!response.ok) {
    throw new MorphologyApiError(
      `形態素解析API（Yahoo!テキスト解析）がエラーを返しました（HTTP ${response.status}）`,
    )
  }

  let ボディ: unknown
  try {
    ボディ = await response.json()
  } catch (cause) {
    throw new MorphologyApiError(
      '形態素解析APIのレスポンスを JSON として解釈できませんでした',
      { cause },
    )
  }

  // JSON-RPC のエラー応答（HTTP 200 でも error フィールドで返る）は明示的にエラーへ変換する
  const エラー応答 =
    typeof ボディ === 'object' && ボディ !== null
      ? (ボディ as Record<string, unknown>).error
      : undefined
  if (typeof エラー応答 === 'object' && エラー応答 !== null) {
    const { code, message } = エラー応答 as { code?: unknown; message?: unknown }
    throw new MorphologyApiError(
      `形態素解析APIがエラーを返しました（code: ${code}, message: ${message}）`,
    )
  }

  return 形態素一覧として検証する(ボディ)
}
