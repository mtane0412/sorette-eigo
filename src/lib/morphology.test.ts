/**
 * morphology.ts（日本語形態素解析クライアント）のテスト。
 *
 * Yahoo!テキスト解析API（日本語形態素解析）で入力を形態素に分解します。
 * 外部 API への実リクエストは行わず、fetch をモックして
 * リクエスト組み立て・レスポンス整形・エラー処理（fail-fast）を検証します。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MorphologyApiError, analyzeMorphemes } from './morphology'

/** Yahoo!テキスト解析API が 200 で返す形式を模したレスポンスボディ */
const アルミサッシの正常レスポンス = {
  id: '1',
  jsonrpc: '2.0',
  result: {
    tokens: [
      ['アルミ', 'あるみ', 'アルミ', '名詞', '普通名詞', '*', '*'],
      ['サッシ', 'さっし', 'サッシ', '名詞', '普通名詞', '*', '*'],
    ],
  },
}

const fetchモック = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchモック)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchモック.mockReset()
})

describe('analyzeMorphemes', () => {
  it('形態素を表記と品詞のペアに整形して返す', async () => {
    fetchモック.mockResolvedValue(
      new Response(JSON.stringify(アルミサッシの正常レスポンス), { status: 200 }),
    )

    const 結果 = await analyzeMorphemes('アルミサッシ')

    expect(結果).toEqual([
      { surface: 'アルミ', pos: '名詞' },
      { surface: 'サッシ', pos: '名詞' },
    ])
  })

  it('Client ID をクエリパラメータで渡し、JSON-RPC 形式で POST する', async () => {
    // ブラウザからは User-Agent ヘッダーでの認証が使えない（CORS の
    // access-control-allow-headers が Content-Type のみ）ため、appid クエリで認証する
    fetchモック.mockResolvedValue(
      new Response(JSON.stringify(アルミサッシの正常レスポンス), { status: 200 }),
    )

    await analyzeMorphemes('アルミサッシ')

    const [リクエストURL, リクエスト設定] = fetchモック.mock.calls[0]
    expect(リクエストURL).toMatch(/^https:\/\/jlp\.yahooapis\.jp\/jsonrpc\?appid=.+$/)
    expect(リクエスト設定.method).toBe('POST')
    expect(リクエスト設定.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(リクエスト設定.body)).toEqual({
      id: '1',
      jsonrpc: '2.0',
      method: 'jlp.maservice.parse',
      params: { q: 'アルミサッシ' },
    })
  })

  it('接続エラーの場合は MorphologyApiError を投げる（fail-fast）', async () => {
    fetchモック.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(analyzeMorphemes('アルミサッシ')).rejects.toThrow(MorphologyApiError)
  })

  it('HTTP エラーの場合は MorphologyApiError を投げる（fail-fast）', async () => {
    fetchモック.mockResolvedValue(new Response('Internal Server Error', { status: 500 }))

    await expect(analyzeMorphemes('アルミサッシ')).rejects.toThrow(MorphologyApiError)
  })

  it('レスポンスが JSON でない場合は MorphologyApiError を投げる（fail-fast）', async () => {
    fetchモック.mockResolvedValue(new Response('これはJSONではありません', { status: 200 }))

    await expect(analyzeMorphemes('アルミサッシ')).rejects.toThrow(MorphologyApiError)
  })

  it('result.tokens が無いエラーボディの場合は MorphologyApiError を投げる（fail-fast）', async () => {
    // Yahoo API は認証エラー等を 200 + エラーボディで返すことがある
    fetchモック.mockResolvedValue(
      new Response(JSON.stringify({ Error: { Message: 'Your Request was Forbidden' } }), {
        status: 200,
      }),
    )

    await expect(analyzeMorphemes('アルミサッシ')).rejects.toThrow(MorphologyApiError)
  })

  it('tokens の要素が期待した形でない場合は MorphologyApiError を投げる（fail-fast）', async () => {
    fetchモック.mockResolvedValue(
      new Response(
        JSON.stringify({ id: '1', jsonrpc: '2.0', result: { tokens: [[123, null]] } }),
        { status: 200 },
      ),
    )

    await expect(analyzeMorphemes('アルミサッシ')).rejects.toThrow(MorphologyApiError)
  })
})
