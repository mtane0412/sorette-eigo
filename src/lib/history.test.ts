/**
 * history.ts（判定履歴の localStorage 永続化）のテスト。
 *
 * jsdom の localStorage を利用して、履歴の追加・読み込み・上限・
 * 破損データの検知・クリアを検証します。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  HISTORY_STORAGE_KEY,
  HistoryLoadError,
  MAX_HISTORY_ENTRIES,
  addHistoryEntry,
  clearHistory,
  loadHistory,
} from './history'
import type { JudgeResult } from '../types'

/** テスト用の判定結果を作るヘルパー */
function 判定結果を作る(input: string): JudgeResult {
  return {
    input,
    verdict: 'english',
    englishWord: 'control',
    note: '英語の control が語源です。',
    dictionary: { exists: true, phonetic: '/kənˈtɹəʊl/', meanings: [] },
    explanation: 'control は「制御」を意味します。',
    examples: [{ english: 'I can control it.', japanese: '私はそれをコントロールできます。' }],
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('loadHistory', () => {
  it('履歴が無ければ空配列を返す', () => {
    expect(loadHistory()).toEqual([])
  })

  it('保存された履歴を新しい順（先頭が最新）で返す', () => {
    addHistoryEntry(判定結果を作る('コントロール'), 1000)
    addHistoryEntry(判定結果を作る('クラフト'), 2000)

    const 履歴 = loadHistory()

    expect(履歴).toHaveLength(2)
    expect(履歴[0].input).toBe('クラフト')
    expect(履歴[1].input).toBe('コントロール')
  })

  it('壊れた JSON が保存されていたら HistoryLoadError を投げる（fail-fast）', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, '{壊れたJSON')
    expect(() => loadHistory()).toThrow(HistoryLoadError)
  })

  it('配列でないデータが保存されていたら HistoryLoadError を投げる（fail-fast）', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ not: 'array' }))
    expect(() => loadHistory()).toThrow(HistoryLoadError)
  })
})

describe('addHistoryEntry', () => {
  it('判定結果に ID と判定日時を付与して保存し、そのエントリを返す', () => {
    const エントリ = addHistoryEntry(判定結果を作る('コントロール'), 1234567890)

    expect(エントリ.id).toBeTruthy()
    expect(エントリ.judgedAt).toBe(1234567890)
    expect(エントリ.input).toBe('コントロール')
    expect(loadHistory()).toEqual([エントリ])
  })

  it('エントリごとに異なる ID を付与する', () => {
    const エントリ1 = addHistoryEntry(判定結果を作る('コントロール'), 1000)
    const エントリ2 = addHistoryEntry(判定結果を作る('コントロール'), 2000)
    expect(エントリ1.id).not.toBe(エントリ2.id)
  })

  it('上限件数を超えたら古いエントリから削除する', () => {
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) {
      addHistoryEntry(判定結果を作る(`単語${i}`), i)
    }

    const 履歴 = loadHistory()

    expect(履歴).toHaveLength(MAX_HISTORY_ENTRIES)
    // 最新のものが先頭に残り、最古の5件が消えている
    expect(履歴[0].input).toBe(`単語${MAX_HISTORY_ENTRIES + 4}`)
    expect(履歴[履歴.length - 1].input).toBe('単語5')
  })
})

describe('clearHistory', () => {
  it('保存済みの履歴をすべて削除する', () => {
    addHistoryEntry(判定結果を作る('コントロール'), 1000)
    clearHistory()
    expect(loadHistory()).toEqual([])
  })

  it('壊れたデータも削除できる（復旧手段として機能する）', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, '{壊れたJSON')
    clearHistory()
    expect(loadHistory()).toEqual([])
  })
})
