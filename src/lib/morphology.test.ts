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

  it('プロキシへ preflight が発生しない形式で POST する（Client ID は含めない）', async () => {
    // Client ID はプロキシ側（本番: Cloudflare Worker のシークレット、
    // 開発: vite の dev プロキシが .env.local から注入）で付与するため、
    // クライアントのリクエストには含めない。
    // Content-Type は CORS-safelisted な text/plain にして、preflight（OPTIONS）の
    // 往復を発生させずシンプルリクエストとして送る
    fetchモック.mockResolvedValue(
      new Response(JSON.stringify(アルミサッシの正常レスポンス), { status: 200 }),
    )

    await analyzeMorphemes('アルミサッシ')

    const [リクエストURL, リクエスト設定] = fetchモック.mock.calls[0]
    // テストは開発モード相当（import.meta.env.PROD が false）のため dev プロキシのパスになる
    expect(リクエストURL).toBe('/api/morphology')
    expect(リクエストURL).not.toContain('appid')
    expect(リクエスト設定.method).toBe('POST')
    expect(リクエスト設定.headers).toEqual({ 'Content-Type': 'text/plain' })
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

  it('JSON-RPC のエラー応答の場合は code と message を含む MorphologyApiError を投げる', async () => {
    fetchモック.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '1',
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid Request' },
        }),
        { status: 200 },
      ),
    )

    await expect(analyzeMorphemes('アルミサッシ')).rejects.toThrow(
      '形態素解析APIがエラーを返しました（code: -32600, message: Invalid Request）',
    )
  })

  it('API のリクエスト上限（4KB）を超える入力は送信せずに MorphologyApiError を投げる', async () => {
    // 「あ」は UTF-8 で 3 バイトのため、2000 文字で上限の 4096 バイトを確実に超える
    const 長すぎる入力 = 'あ'.repeat(2000)

    await expect(analyzeMorphemes(長すぎる入力)).rejects.toThrow(MorphologyApiError)
    expect(fetchモック).not.toHaveBeenCalled()
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
