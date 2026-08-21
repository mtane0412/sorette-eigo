/**
 * 日本語形態素解析クライアント（Yahoo!テキスト解析API）。
 *
 * ユーザーの入力を日本語の段階で形態素（パーツ）に分解するために使用します。
 * 複合語の分解（アルミサッシ → アルミ + サッシ）と、品詞情報による
 * 文章の検出（助詞・判定詞を含むか）を決定的に行うのが目的です。
 *
 * 認証はブラウザの CORS 制約により User-Agent ヘッダーが使えないため
 * （access-control-allow-headers が Content-Type のみ）、appid クエリ
 * パラメータで行います。Client ID はクライアントサイドへの埋め込みを
 * 前提とした識別子であり、秘密鍵ではありません。
 */

/** Yahoo!テキスト解析API（JSON-RPC）のエンドポイント */
const YAHOO_JLP_ENDPOINT = 'https://jlp.yahooapis.jp/jsonrpc'

/** Yahoo!デベロッパーネットワークの Client ID */
const YAHOO_CLIENT_ID =
  'dmVyPTIwMjUwNyZpZD01VVZqM0tLT1NSJmhhc2g9TjJReE1XRmpNMlpsT1RsbU9HSTFNQQ'

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
  let response: Response
  try {
    response = await fetch(`${YAHOO_JLP_ENDPOINT}?appid=${encodeURIComponent(YAHOO_CLIENT_ID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '1',
        jsonrpc: '2.0',
        method: 'jlp.maservice.parse',
        params: { q: text },
      }),
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

  return 形態素一覧として検証する(ボディ)
}
