/**
 * HistoryList（判定履歴一覧）のテスト。
 *
 * 履歴の表示・空状態・エントリ選択・クリア操作を検証します。
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HistoryList } from './HistoryList'
import type { HistoryEntry } from '../types'

const 履歴サンプル: HistoryEntry[] = [
  {
    id: 'id-1',
    judgedAt: new Date('2026-08-21T10:00:00').getTime(),
    input: 'コントロール',
    verdict: 'english',
    englishWord: 'control',
    note: '',
    dictionary: { exists: true, phonetic: null, meanings: [] },
    explanation: '解説',
    examples: [],
  },
  {
    id: 'id-2',
    judgedAt: new Date('2026-08-21T11:00:00').getTime(),
    input: 'もちもち',
    verdict: 'not_english',
    englishWord: null,
    note: '',
    dictionary: null,
    explanation: null,
    examples: [],
  },
]

describe('HistoryList', () => {
  it('履歴が無いときは空状態メッセージを表示する', () => {
    render(<HistoryList entries={[]} onSelect={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByText('まだ履歴がありません')).toBeInTheDocument()
  })

  it('履歴エントリの入力語・判定・英単語を表示する', () => {
    render(<HistoryList entries={履歴サンプル} onSelect={vi.fn()} onClear={vi.fn()} />)

    expect(screen.getByText('コントロール')).toBeInTheDocument()
    expect(screen.getByText('control')).toBeInTheDocument()
    expect(screen.getByText('もちもち')).toBeInTheDocument()
  })

  it('エントリをクリックすると onSelect にそのエントリを渡す', async () => {
    const onSelectモック = vi.fn()
    render(<HistoryList entries={履歴サンプル} onSelect={onSelectモック} onClear={vi.fn()} />)

    await userEvent.click(screen.getByText('コントロール'))

    expect(onSelectモック).toHaveBeenCalledWith(履歴サンプル[0])
  })

  it('「履歴をクリア」ボタンで onClear を呼ぶ', async () => {
    const onClearモック = vi.fn()
    render(<HistoryList entries={履歴サンプル} onSelect={vi.fn()} onClear={onClearモック} />)

    await userEvent.click(screen.getByRole('button', { name: '履歴をクリア' }))

    expect(onClearモック).toHaveBeenCalled()
  })

  it('履歴が無いときはクリアボタンを表示しない', () => {
    render(<HistoryList entries={[]} onSelect={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '履歴をクリア' })).not.toBeInTheDocument()
  })
})
