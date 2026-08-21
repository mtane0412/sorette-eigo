/**
 * 英単語の辞書照会クライアント。
 *
 * メイン辞書は Free Dictionary API（https://dictionaryapi.dev/）。
 * メイン辞書は本体サーバーが不安定で、キャッシュミス時に 502 を返すことがあるため
 * （2026-08-21 実測: キャッシュ回避リクエスト 10 回中 6 回が 502）、
 * メイン辞書の失敗時のみ予備辞書 Datamuse API（https://www.datamuse.com/api/）へ
 * フォールバックします。どちらも API キー不要・CORS 対応で、ブラウザから直接呼び出します。
 *
 * 「単語が見つからない」はメイン辞書からの正常な回答（404）として扱い、
 * フォールバックしません。フォールバックするのは接続エラー・5xx のみです。
 */
import type { DictionaryLookupResult } from '../types'

/** Free Dictionary API（メイン辞書）のエンドポイントのベース URL */
const DICTIONARYAPI_BASE_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/'

/** Datamuse API（予備辞書）のエンドポイントのベース URL */
const DATAMUSE_BASE_URL = 'https://api.datamuse.com/words'

/**
 * 辞書の照会に失敗したことを表すエラー。
 *
 * 「単語が見つからない（404 / 候補なし）」は正常系として扱うため、このエラーにはなりません。
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
 * メイン辞書（Free Dictionary API）で英単語を照会します。
 *
 * @throws {DictionaryApiError} ネットワークエラー、404 以外のエラーステータスの場合
 */
async function メイン辞書で照会する(単語: string): Promise<DictionaryLookupResult> {
  let response: Response
  try {
    response = await fetch(`${DICTIONARYAPI_BASE_URL}${encodeURIComponent(単語)}`)
  } catch (cause) {
    throw new DictionaryApiError('メイン辞書（Free Dictionary API）への接続に失敗しました', {
      cause,
    })
  }

  if (response.status === 404) {
    return { exists: false, phonetic: null, meanings: [], source: 'dictionaryapi' }
  }
  if (!response.ok) {
    throw new DictionaryApiError(
      `メイン辞書（Free Dictionary API）がエラーを返しました（HTTP ${response.status}）`,
    )
  }

  const entries = (await response.json()) as DictionaryApiEntry[]
  const 先頭エントリ = entries[0]
  if (!先頭エントリ) {
    throw new DictionaryApiError('メイン辞書のレスポンスが空でした')
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
    source: 'dictionaryapi',
  }
}

/** Datamuse のレスポンスのうち、このアプリで使う部分の型 */
interface DatamuseEntry {
  word: string
  /** 「品詞タグ\t定義文」形式の文字列の配列（md=d 指定時のみ） */
  defs?: string[]
}

/** Datamuse の品詞タグ → 表示用の品詞名の対応表 */
const 品詞タグの対応: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
}

/**
 * Datamuse の defs（「品詞タグ\t定義文」の配列）を品詞ごとの代表定義に整形します。
 * 同じ品詞が複数ある場合は最初の定義のみを採用します。
 */
function Datamuseの定義を整形する(defs: string[]): DictionaryLookupResult['meanings'] {
  const 出現済み品詞 = new Set<string>()
  const meanings: DictionaryLookupResult['meanings'] = []
  for (const def of defs) {
    const タブ位置 = def.indexOf('\t')
    if (タブ位置 === -1) {
      continue
    }
    const 品詞 = 品詞タグの対応[def.slice(0, タブ位置)] ?? def.slice(0, タブ位置)
    const 定義 = def.slice(タブ位置 + 1).trim()
    if (定義 === '' || 出現済み品詞.has(品詞)) {
      continue
    }
    出現済み品詞.add(品詞)
    meanings.push({ partOfSpeech: 品詞, definition: 定義 })
  }
  return meanings
}

/**
 * 予備辞書（Datamuse API）で英単語を照会します。
 *
 * Datamuse の `sp=` は「綴りが近い単語」の候補を返すため、
 * 先頭候補が照会単語と完全一致した場合のみ「存在する」とみなします。
 * 発音記号（IPA）は提供されないため phonetic は常に null です。
 *
 * @throws {DictionaryApiError} ネットワークエラー、エラーステータスの場合
 */
async function 予備辞書で照会する(単語: string): Promise<DictionaryLookupResult> {
  let response: Response
  try {
    response = await fetch(`${DATAMUSE_BASE_URL}?sp=${encodeURIComponent(単語)}&md=d&max=1`)
  } catch (cause) {
    throw new DictionaryApiError('予備辞書（Datamuse）への接続に失敗しました', { cause })
  }

  if (!response.ok) {
    throw new DictionaryApiError(`予備辞書（Datamuse）がエラーを返しました（HTTP ${response.status}）`)
  }

  const entries = (await response.json()) as DatamuseEntry[]
  const 先頭候補 = entries[0]
  if (!先頭候補 || 先頭候補.word.toLowerCase() !== 単語.toLowerCase()) {
    return { exists: false, phonetic: null, meanings: [], source: 'datamuse' }
  }

  return {
    exists: true,
    phonetic: null,
    meanings: Datamuseの定義を整形する(先頭候補.defs ?? []),
    source: 'datamuse',
  }
}

/**
 * 英単語を辞書で照会します。
 *
 * メイン辞書（Free Dictionary API）で照会し、接続エラー・5xx の場合のみ
 * 予備辞書（Datamuse API）へフォールバックします。
 * どちらの辞書を使ったかは結果の `source` で判別できます。
 *
 * @param word - 照会する英単語
 * @returns 単語の存在有無・発音記号・品詞ごとの代表的な定義・使用した辞書
 * @throws {DictionaryApiError} 入力が空、または両方の辞書が失敗した場合
 */
export async function lookupEnglishWord(word: string): Promise<DictionaryLookupResult> {
  const 照会単語 = word.trim()
  if (照会単語 === '') {
    throw new DictionaryApiError('照会する英単語が空です')
  }

  let メイン辞書の失敗: unknown
  try {
    return await メイン辞書で照会する(照会単語)
  } catch (cause) {
    メイン辞書の失敗 = cause
  }

  // メイン辞書が失敗した場合のみ予備辞書へフォールバックする
  // （ユーザー承認済み: 2026-08-21 のメイン辞書バックエンド障害への対応）
  try {
    return await 予備辞書で照会する(照会単語)
  } catch (予備辞書の失敗) {
    throw new DictionaryApiError(
      'メイン辞書（Free Dictionary API）と予備辞書（Datamuse）の両方への照会に失敗しました。' +
        `メイン辞書: ${メイン辞書の失敗 instanceof Error ? メイン辞書の失敗.message : String(メイン辞書の失敗)}`,
      { cause: 予備辞書の失敗 },
    )
  }
}
