/**
 * 形態素解析プロキシ（Cloudflare Worker）。
 *
 * アプリ（GitHub Pages / ローカル開発）からのリクエストを
 * Yahoo!テキスト解析API（日本語形態素解析）へ中継します。
 *
 * 目的: Yahoo の Client ID をクライアント配布物に含めず、Worker の
 * シークレット（YAHOO_CLIENT_ID）として秘匿すること。
 *
 * オリジン制限について: Origin ヘッダーは curl 等では偽装できるため
 * 完全な防御ではありませんが、ブラウザからの安易な相乗り利用と
 * 意図しないサイトへの組み込みを防ぐ目的で許可リスト制にしています。
 *
 * デプロイ:
 *   cd workers/morphology
 *   npx wrangler deploy
 *   npx wrangler secret put YAHOO_CLIENT_ID  # Client ID を対話入力
 */

/** Yahoo!テキスト解析API（JSON-RPC）のエンドポイント */
const YAHOO_JLP_ENDPOINT = 'https://jlp.yahooapis.jp/jsonrpc'

/** リクエストを許可するオリジン（アプリの配信元） */
const ALLOWED_ORIGINS = [
  // 本番（GitHub Pages）
  'https://mtane0412.github.io',
  // ローカル開発（vite dev / vite preview）
  'http://localhost:5173',
  'http://localhost:4173',
]

/** Worker が参照する環境変数（wrangler secret で設定する） */
export interface Env {
  /** Yahoo!デベロッパーネットワークの Client ID */
  YAHOO_CLIENT_ID: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const オリジン = request.headers.get('Origin')
    const 許可オリジン = オリジン !== null && ALLOWED_ORIGINS.includes(オリジン) ? オリジン : null

    // アプリは text/plain のシンプルリクエストで送るため通常 preflight は発生しないが、
    // 将来ヘッダーを増やしても動くよう OPTIONS には正しく応答しておく
    if (request.method === 'OPTIONS') {
      if (許可オリジン === null) {
        return new Response(null, { status: 403 })
      }
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 許可オリジン,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      })
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    if (許可オリジン === null) {
      return new Response('Forbidden', { status: 403 })
    }

    // ボディ（JSON-RPC）はそのまま中継し、認証だけをこの Worker が付与する
    const 中継レスポンス = await fetch(
      `${YAHOO_JLP_ENDPOINT}?appid=${encodeURIComponent(env.YAHOO_CLIENT_ID)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      },
    )

    // ステータスとボディは加工せず透過し、CORS ヘッダーだけを付けて返す
    return new Response(await 中継レスポンス.text(), {
      status: 中継レスポンス.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': 許可オリジン,
        Vary: 'Origin',
      },
    })
  },
}
