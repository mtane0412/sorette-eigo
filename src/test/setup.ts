/**
 * Vitest セットアップファイル。
 *
 * - @testing-library/jest-dom のカスタムマッチャー（toBeInTheDocument など）を
 *   すべてのテストで使えるように読み込みます。
 * - Vitest の globals を無効にしているため、Testing Library の自動クリーンアップが
 *   効きません。テストごとに DOM を確実に破棄するよう明示的に登録します。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
