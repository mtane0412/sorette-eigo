/**
 * dictionary.ts（英単語辞書クライアント）のテスト。
 *
 * メイン辞書は Free Dictionary API、メイン辞書が失敗した場合のみ
 * 予備辞書 Datamuse API へフォールバックします。
 * 外部 API への実リクエストは行わず、fetch をモックして
 * 存在チェック・レスポンス整形・フォールバック・エラー処理を検証します。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DictionaryApiError, lookupEnglishWord } from './dictionary'

/** dictionaryapi.dev が 200 で返す形式を模したレスポンスボディ（抜粋） */
const メイン辞書のcontrol正常レスポンス = [
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

/** Datamuse API が返す形式を模したレスポンスボディ */
const 予備辞書のcontrol正常レスポンス = [
  {
    word: 'control',
    score: 192114,
    defs: [
      'v\tTo exercise influence over.',
      'n\tAn influence or authority over something.',
      'n\tRestraint or ability to contain movements.',
    ],
  },
]

const fetchモック = vi.fn()

/** メイン辞書が指定レスポンス、予備辞書が指定レスポンスを返すように fetch を設定するヘルパー */
function fetchを設定する(設定: {
  メイン辞書: () => Promise<Response> | Response
  予備辞書?: () => Promise<Response> | Response
}) {
  fetchモック.mockImplementation(async (url: string) => {
    if (url.includes('api.dictionaryapi.dev')) {
      return 設定.メイン辞書()
    }
    if (url.includes('api.datamuse.com')) {
      if (!設定.予備辞書) {
        throw new Error('テスト設定エラー: 予備辞書のレスポンスが未設定です')
      }
      return 設定.予備辞書()
    }
    throw new Error(`テスト設定エラー: 想定外の URL です: ${url}`)
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchモック)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchモック.mockReset()
})

describe('lookupEnglishWord（メイン辞書: Free Dictionary API）', () => {
  it('辞書に存在する単語は exists: true と発音・定義・辞書種別を返す', async () => {
    fetchを設定する({
      メイン辞書: () =>
        new Response(JSON.stringify(メイン辞書のcontrol正常レスポンス), { status: 200 }),
    })

    const 結果 = await lookupEnglishWord('control')

    expect(結果.exists).toBe(true)
    expect(結果.phonetic).toBe('/kənˈtɹəʊl/')
    expect(結果.source).toBe('dictionaryapi')
    expect(結果.meanings).toEqual([
      { partOfSpeech: 'noun', definition: 'The ability to influence or direct.' },
      { partOfSpeech: 'verb', definition: 'To exercise influence over.' },
    ])
  })

  it('Free Dictionary API の正しいエンドポイントに（URL エンコードして）リクエストする', async () => {
    fetchを設定する({
      メイン辞書: () =>
        new Response(JSON.stringify(メイン辞書のcontrol正常レスポンス), { status: 200 }),
    })

    await lookupEnglishWord('ice cream')

    expect(fetchモック).toHaveBeenCalledWith(
      'https://api.dictionaryapi.dev/api/v2/entries/en/ice%20cream',
    )
  })

  it('メイン辞書に存在しない単語（404）は exists: false を返し、予備辞書には問い合わせない', async () => {
    // 404 は「単語が無い」という正常な回答のため、フォールバックしない
    fetchを設定する({
      メイン辞書: () =>
        new Response(JSON.stringify({ title: 'No Definitions Found' }), { status: 404 }),
    })

    const 結果 = await lookupEnglishWord('konnichiwa')

    expect(結果).toEqual({
      exists: false,
      phonetic: null,
      meanings: [],
      source: 'dictionaryapi',
    })
    expect(fetchモック).toHaveBeenCalledTimes(1)
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
    fetchを設定する({
      メイン辞書: () => new Response(JSON.stringify(phoneticなしレスポンス), { status: 200 }),
    })

    const 結果 = await lookupEnglishWord('rare')

    expect(結果.exists).toBe(true)
    expect(結果.phonetic).toBeNull()
  })

  it('空文字・空白のみの単語は DictionaryApiError を投げる（fail-fast・フォールバックもしない）', async () => {
    await expect(lookupEnglishWord('   ')).rejects.toThrow(DictionaryApiError)
    expect(fetchモック).not.toHaveBeenCalled()
  })
})

describe('lookupEnglishWord（予備辞書 Datamuse へのフォールバック）', () => {
  it('メイン辞書が 5xx エラーのとき予備辞書で照会し、source: datamuse を返す', async () => {
    fetchを設定する({
      メイン辞書: () => new Response('error code: 502', { status: 502 }),
      予備辞書: () =>
        new Response(JSON.stringify(予備辞書のcontrol正常レスポンス), { status: 200 }),
    })

    const 結果 = await lookupEnglishWord('control')

    expect(結果.exists).toBe(true)
    expect(結果.source).toBe('datamuse')
    // Datamuse は発音記号（IPA）を提供しないため null
    expect(結果.phonetic).toBeNull()
    // 品詞ごとに最初の定義だけを採用する（n が 2 件あっても 1 件に集約）
    expect(結果.meanings).toEqual([
      { partOfSpeech: 'verb', definition: 'To exercise influence over.' },
      { partOfSpeech: 'noun', definition: 'An influence or authority over something.' },
    ])
  })

  it('メイン辞書がネットワークエラーのときも予備辞書へフォールバックする', async () => {
    fetchを設定する({
      メイン辞書: () => Promise.reject(new TypeError('Failed to fetch')),
      予備辞書: () =>
        new Response(JSON.stringify(予備辞書のcontrol正常レスポンス), { status: 200 }),
    })

    const 結果 = await lookupEnglishWord('control')

    expect(結果.exists).toBe(true)
    expect(結果.source).toBe('datamuse')
  })

  it('予備辞書には Datamuse の正しいエンドポイントでリクエストする', async () => {
    fetchを設定する({
      メイン辞書: () => new Response('error code: 502', { status: 502 }),
      予備辞書: () =>
        new Response(JSON.stringify(予備辞書のcontrol正常レスポンス), { status: 200 }),
    })

    await lookupEnglishWord('ice cream')

    expect(fetchモック).toHaveBeenCalledWith(
      'https://api.datamuse.com/words?sp=ice%20cream&md=d&max=1',
    )
  })

  it('予備辞書の先頭候補が照会単語と一致しなければ exists: false を返す', async () => {
    // Datamuse の sp= は「綴りが近い単語」を返すため、完全一致のみ存在とみなす
    fetchを設定する({
      メイン辞書: () => new Response('error code: 502', { status: 502 }),
      予備辞書: () =>
        new Response(
          JSON.stringify([{ word: 'samaritan', score: 1040, defs: ['n\tA charitable person.'] }]),
          { status: 200 },
        ),
    })

    const 結果 = await lookupEnglishWord('sarariman')

    expect(結果).toEqual({ exists: false, phonetic: null, meanings: [], source: 'datamuse' })
  })

  it('予備辞書の候補が空配列なら exists: false を返す', async () => {
    fetchを設定する({
      メイン辞書: () => new Response('error code: 502', { status: 502 }),
      予備辞書: () => new Response(JSON.stringify([]), { status: 200 }),
    })

    const 結果 = await lookupEnglishWord('zzzzzz')

    expect(結果.exists).toBe(false)
    expect(結果.source).toBe('datamuse')
  })

  it('予備辞書に定義（defs）が無い単語は exists: true・meanings 空で返す', async () => {
    fetchを設定する({
      メイン辞書: () => new Response('error code: 502', { status: 502 }),
      予備辞書: () => new Response(JSON.stringify([{ word: 'zyzzyva', score: 10 }]), { status: 200 }),
    })

    const 結果 = await lookupEnglishWord('zyzzyva')

    expect(結果.exists).toBe(true)
    expect(結果.meanings).toEqual([])
  })

  it('両方の辞書が失敗したら DictionaryApiError を投げる', async () => {
    fetchを設定する({
      メイン辞書: () => new Response('error code: 502', { status: 502 }),
      予備辞書: () => Promise.reject(new TypeError('Failed to fetch')),
    })

    await expect(lookupEnglishWord('control')).rejects.toThrow(DictionaryApiError)
    await expect(lookupEnglishWord('control')).rejects.toThrow(/両方/)
  })
})
