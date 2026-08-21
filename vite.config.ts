/// <reference types="vitest/config" />
/**
 * Vite / Vitest 設定ファイル。
 *
 * - React プラグインを有効化しています。
 * - Vitest は jsdom 環境で実行し、Testing Library のセットアップを読み込みます。
 * - 開発サーバーには形態素解析の dev プロキシ（/api/morphology）を設定しています。
 *   本番の Cloudflare Worker プロキシは GitHub Pages のオリジンのみ許可するため、
 *   ローカル開発では dev サーバーの Node 側から Yahoo API へ直接中継します。
 *   Yahoo の Client ID は .env.local（gitignore 済み）の YAHOO_CLIENT_ID から読み込みます。
 */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // 第 3 引数 '' で VITE_ プレフィックス無しの変数（YAHOO_CLIENT_ID）も読み込む。
  // クライアントコードには公開されず、dev プロキシの書き換えにのみ使う
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/morphology': {
          target: 'https://jlp.yahooapis.jp',
          changeOrigin: true,
          rewrite: () =>
            `/jsonrpc?appid=${encodeURIComponent(env.YAHOO_CLIENT_ID ?? '')}`,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
