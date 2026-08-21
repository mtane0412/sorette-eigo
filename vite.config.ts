/// <reference types="vitest/config" />
/**
 * Vite / Vitest 設定ファイル。
 *
 * - React プラグインを有効化しています。
 * - Vitest は jsdom 環境で実行し、Testing Library のセットアップを読み込みます。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
