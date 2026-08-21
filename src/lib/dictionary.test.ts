/**
 * dictionary.ts（Free Dictionary API クライアント）のテスト。
 *
 * 外部 API への実リクエストは行わず、fetch をモックして
 * 単語の存在チェック・レスポンス整形・エラー処理を検証します。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DictionaryApiError, lookupEnglishWord } from './dictionary'

/** dictionaryapi.dev が 200 で返す形式を模したレスポンスボディ（抜粋） */
const controlの正常レスポンス = [
  {
    word: 'control',
    phonetic: '/kənˈtɹəʊl/',
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [
          { definition: 'The ability to influence or direct.' },
          { definition: 'A separate group used as a standard of comparison.' },
        ],
      },
      {
        partOfSpeech: 'verb',
        definitions: [{ definition: 'To exercise influence over.' }],
      },
    ],
  },
]

const fetchモック = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchモック)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchモック.mockReset()
})

describe('lookupEnglishWord', () => {
  it('辞書に存在する単語は exists: true と発音・定義を返す', async () => {
    fetchモック.mockResolvedValue(
      new Response(JSON.stringify(controlの正常レスポンス), { status: 200 }),
    )

    const 結果 = await lookupEnglishWord('control')

    expect(結果.exists).toBe(true)
    expect(結果.phonetic).toBe('/kənˈtɹəʊl/')
    expect(結果.meanings).toEqual([
      { partOfSpeech: 'noun', definition: 'The ability to influence or direct.' },
      { partOfSpeech: 'verb', definition: 'To exercise influence over.' },
    ])
  })

  it('Free Dictionary API の正しいエンドポイントに（URL エンコードして）リクエストする', async () => {
    fetchモック.mockResolvedValue(
      new Response(JSON.stringify(controlの正常レスポンス), { status: 200 }),
    )

    await lookupEnglishWord('ice cream')

    expect(fetchモック).toHaveBeenCalledWith(
      'https://api.dictionaryapi.dev/api/v2/entries/en/ice%20cream',
    )
  })

  it('辞書に存在しない単語（404）は exists: false を返す', async () => {
    fetchモック.mockResolvedValue(
      new Response(JSON.stringify({ title: 'No Definitions Found' }), { status: 404 }),
    )

    const 結果 = await lookupEnglishWord('konnichiwa')

    expect(結果).toEqual({ exists: false, phonetic: null, meanings: [] })
  })

  it('phonetic が無い単語は phonetic: null を返す', async () => {
    const phoneticなしレスポンス = [
      {
        word: 'rare',
        meanings: [
          { partOfSpeech: 'adjective', definitions: [{ definition: 'Uncommon.' }] },
        ],
      },
    ]
    fetchモック.mockResolvedValue(
      new Response(JSON.stringify(phoneticなしレスポンス), { status: 200 }),
    )

    const 結果 = await lookupEnglishWord('rare')

    expect(結果.exists).toBe(true)
    expect(結果.phonetic).toBeNull()
  })

  it('404 以外のエラーステータスは DictionaryApiError を投げる', async () => {
    fetchモック.mockResolvedValue(new Response('Internal Server Error', { status: 500 }))

    await expect(lookupEnglishWord('control')).rejects.toThrow(DictionaryApiError)
  })

  it('ネットワークエラーは DictionaryApiError を投げる', async () => {
    fetchモック.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(lookupEnglishWord('control')).rejects.toThrow(DictionaryApiError)
  })

  it('空文字・空白のみの単語は DictionaryApiError を投げる（fail-fast）', async () => {
    await expect(lookupEnglishWord('   ')).rejects.toThrow(DictionaryApiError)
    expect(fetchモック).not.toHaveBeenCalled()
  })
})
