/**
 * 形態素解析プロキシ（Cloudflare Worker）のテスト。
 *
 * Client ID を秘匿するため、アプリからのリクエストを Yahoo!テキスト解析API へ
 * 中継する Worker の振る舞い（CORS・オリジン制限・中継・エラー透過）を検証します。
 * Yahoo API への実リクエストは行わず、fetch をモックします。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from './index'

/** テスト用の環境変数（Worker のシークレットに相当） */
const テスト環境: Env = { YAHOO_CLIENT_ID: 'test-client-id' }

/** アプリ本番（GitHub Pages）のオリジン */
const 本番オリジン = 'https://mtane0412.github.io'

const JSONRPCリクエストボディ = JSON.stringify({
  id: '1',
  jsonrpc: '2.0',
  method: 'jlp.maservice.parse',
  params: { q: 'アルミサッシ' },
})

const Yahoo正常レスポンスボディ = JSON.stringify({
  id: '1',
  jsonrpc: '2.0',
  result: { tokens: [['アルミ', 'あるみ', 'アルミ', '名詞', '普通名詞', '*', '*']] },
})

const fetchモック = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchモック)
  fetchモック.mockResolvedValue(new Response(Yahoo正常レスポンスボディ, { status: 200 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchモック.mockReset()
})

/** 許可オリジンからの POST リクエストを組み立てるヘルパー */
function 許可オリジンからのリクエスト(オリジン: string = 本番オリジン): Request {
  return new Request('https://proxy.example.workers.dev/', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: オリジン },
    body: JSONRPCリクエストボディ,
  })
}

describe('形態素解析プロキシ', () => {
  it('許可オリジンからの POST を、シークレットの appid を付けて Yahoo API へ中継する', async () => {
    const レスポンス = await worker.fetch(許可オリジンからのリクエスト(), テスト環境)

    expect(レスポンス.status).toBe(200)
    await expect(レスポンス.text()).resolves.toBe(Yahoo正常レスポンスボディ)

    const [中継先URL, 中継設定] = fetchモック.mock.calls[0]
    expect(中継先URL).toBe('https://jlp.yahooapis.jp/jsonrpc?appid=test-client-id')
    expect(中継設定.method).toBe('POST')
    expect(中継設定.body).toBe(JSONRPCリクエストボディ)
  })

  it('レスポンスに許可オリジンの CORS ヘッダーを付ける', async () => {
    const レスポンス = await worker.fetch(許可オリジンからのリクエスト(), テスト環境)

    expect(レスポンス.headers.get('Access-Control-Allow-Origin')).toBe(本番オリジン)
  })

  it('ローカル開発（vite dev サーバー）のオリジンも許可する', async () => {
    const レスポンス = await worker.fetch(
      許可オリジンからのリクエスト('http://localhost:5173'),
      テスト環境,
    )

    expect(レスポンス.status).toBe(200)
    expect(レスポンス.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  it('許可していないオリジンからのリクエストは 403 で拒否し、中継しない', async () => {
    const レスポンス = await worker.fetch(
      許可オリジンからのリクエスト('https://evil.example.com'),
      テスト環境,
    )

    expect(レスポンス.status).toBe(403)
    expect(fetchモック).not.toHaveBeenCalled()
  })

  it('Origin ヘッダーの無いリクエストは 403 で拒否し、中継しない', async () => {
    const リクエスト = new Request('https://proxy.example.workers.dev/', {
      method: 'POST',
      body: JSONRPCリクエストボディ,
    })

    const レスポンス = await worker.fetch(リクエスト, テスト環境)

    expect(レスポンス.status).toBe(403)
    expect(fetchモック).not.toHaveBeenCalled()
  })

  it('POST 以外のメソッドは 405 で拒否する', async () => {
    const リクエスト = new Request('https://proxy.example.workers.dev/', {
      method: 'GET',
      headers: { Origin: 本番オリジン },
    })

    const レスポンス = await worker.fetch(リクエスト, テスト環境)

    expect(レスポンス.status).toBe(405)
    expect(fetchモック).not.toHaveBeenCalled()
  })

  it('許可オリジンからの OPTIONS（preflight）には CORS ヘッダー付きで応答する', async () => {
    const リクエスト = new Request('https://proxy.example.workers.dev/', {
      method: 'OPTIONS',
      headers: {
        Origin: 本番オリジン,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })

    const レスポンス = await worker.fetch(リクエスト, テスト環境)

    expect(レスポンス.status).toBe(204)
    expect(レスポンス.headers.get('Access-Control-Allow-Origin')).toBe(本番オリジン)
    expect(レスポンス.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(fetchモック).not.toHaveBeenCalled()
  })

  it('Yahoo API のエラーステータスとボディはそのまま返す', async () => {
    fetchモック.mockResolvedValue(
      new Response(JSON.stringify({ Error: { Message: 'Bad Request' } }), { status: 400 }),
    )

    const レスポンス = await worker.fetch(許可オリジンからのリクエスト(), テスト環境)

    expect(レスポンス.status).toBe(400)
    await expect(レスポンス.text()).resolves.toBe(
      JSON.stringify({ Error: { Message: 'Bad Request' } }),
    )
  })
})
