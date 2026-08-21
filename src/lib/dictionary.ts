/**
 * Free Dictionary API（https://dictionaryapi.dev/）のクライアント。
 *
 * 英単語が実在するかどうかの確認と、発音記号・定義の取得を行います。
 * API キー不要・CORS 対応のため、ブラウザから直接呼び出します。
 */
import type { DictionaryLookupResult } from '../types'

/** Free Dictionary API のエンドポイントのベース URL */
const API_BASE_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/'

/**
 * 辞書 API の呼び出しに失敗したことを表すエラー。
 *
 * 「単語が見つからない（404）」は正常系として扱うため、このエラーにはなりません。
 */
export class DictionaryApiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DictionaryApiError'
  }
}

/** dictionaryapi.dev の 200 レスポンスのうち、このアプリで使う部分の型 */
interface DictionaryApiEntry {
  word: string
  phonetic?: string
  meanings?: {
    partOfSpeech: string
    definitions: { definition: string }[]
  }[]
}

/**
 * 英単語を Free Dictionary API で照会します。
 *
 * @param word - 照会する英単語
 * @returns 単語の存在有無・発音記号・品詞ごとの代表的な定義
 * @throws {DictionaryApiError} 入力が空、ネットワークエラー、404 以外のエラーステータスの場合
 */
export async function lookupEnglishWord(word: string): Promise<DictionaryLookupResult> {
  const 照会単語 = word.trim()
  if (照会単語 === '') {
    throw new DictionaryApiError('照会する英単語が空です')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${encodeURIComponent(照会単語)}`)
  } catch (cause) {
    throw new DictionaryApiError('辞書 API への接続に失敗しました', { cause })
  }

  if (response.status === 404) {
    return { exists: false, phonetic: null, meanings: [] }
  }
  if (!response.ok) {
    throw new DictionaryApiError(`辞書 API がエラーを返しました（HTTP ${response.status}）`)
  }

  const entries = (await response.json()) as DictionaryApiEntry[]
  const 先頭エントリ = entries[0]
  if (!先頭エントリ) {
    throw new DictionaryApiError('辞書 API のレスポンスが空でした')
  }

  return {
    exists: true,
    phonetic: 先頭エントリ.phonetic ?? null,
    meanings: (先頭エントリ.meanings ?? [])
      .filter((meaning) => meaning.definitions.length > 0)
      .map((meaning) => ({
        partOfSpeech: meaning.partOfSpeech,
        definition: meaning.definitions[0].definition,
      })),
  }
}
