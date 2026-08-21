/**
 * App（アプリ全体の統合）のテスト。
 *
 * Gemini Nano ラッパーと辞書 API をモジュールモックで置き換え、
 * 「可用性チェック → モデル準備 → 判定 → 結果表示 → 履歴保存」の
 * 一連の流れを検証します。localStorage は jsdom の実装をそのまま使います。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { checkAvailability, createNanoSession, type NanoSession } from './lib/geminiNano'
import { lookupEnglishWord } from './lib/dictionary'
import { addHistoryEntry } from './lib/history'

vi.mock('./lib/geminiNano', async (importOriginal) => {
  const 元モジュール = await importOriginal<typeof import('./lib/geminiNano')>()
  return {
    ...元モジュール,
    checkAvailability: vi.fn(),
    createNanoSession: vi.fn(),
  }
})

vi.mock('./lib/dictionary', async (importOriginal) => {
  const 元モジュール = await importOriginal<typeof import('./lib/dictionary')>()
  return {
    ...元モジュール,
    lookupEnglishWord: vi.fn(),
  }
})

/** モックセッション（NanoSession の公開メソッドのみを模倣） */
const セッションモック = {
  judgeEnglishOrigin: vi.fn(),
  explainWord: vi.fn(),
  makeExampleSentences: vi.fn(),
  destroy: vi.fn(),
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(createNanoSession).mockResolvedValue(セッションモック as unknown as NanoSession)
})

/** 「コントロール → control（英語）」の判定が成功するようモックを仕込むヘルパー */
function 英語判定が成功するように仕込む() {
  セッションモック.judgeEnglishOrigin.mockResolvedValue({
    isEnglishOrigin: true,
    englishWord: 'control',
    note: '英語の control が語源です。',
  })
  vi.mocked(lookupEnglishWord).mockResolvedValue({
    exists: true,
    phonetic: '/kənˈtɹəʊl/',
    meanings: [{ partOfSpeech: 'noun', definition: 'The ability to influence.' }],
  })
  セッションモック.explainWord.mockResolvedValue('control は「制御」を意味します。')
  セッションモック.makeExampleSentences.mockResolvedValue([
    { english: 'I can control it.', japanese: '私はそれをコントロールできます。' },
    { english: 'Stay in control.', japanese: '冷静さを保ちなさい。' },
    { english: 'The remote control is broken.', japanese: 'リモコンが壊れています。' },
  ])
}

describe('App', () => {
  it('モデルが利用可能なら入力フォームを表示する', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('available')
    render(<App />)

    expect(await screen.findByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '判定する' })).toBeInTheDocument()
  })

  it('Prompt API 非対応ブラウザでは案内メッセージを表示する', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('unavailable')
    render(<App />)

    expect(
      await screen.findByText(/Gemini Nano が利用できません/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('モデル未ダウンロードならダウンロードボタンを表示し、完了後にフォームを表示する', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('downloadable')
    render(<App />)

    const ダウンロードボタン = await screen.findByRole('button', {
      name: 'モデルをダウンロード',
    })
    await userEvent.click(ダウンロードボタン)

    expect(vi.mocked(createNanoSession)).toHaveBeenCalled()
    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })

  it('単語を判定すると結果と履歴が表示される', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('available')
    英語判定が成功するように仕込む()
    render(<App />)

    await userEvent.type(await screen.findByRole('textbox'), 'コントロール')
    await userEvent.click(screen.getByRole('button', { name: '判定する' }))

    // 判定結果
    expect(await screen.findByText('英語です！')).toBeInTheDocument()
    expect(screen.getByText('control は「制御」を意味します。')).toBeInTheDocument()
    expect(screen.getByText('I can control it.')).toBeInTheDocument()
    // 履歴にも追加される（結果表示と履歴の2箇所に入力語が現れる）
    expect(screen.getAllByText('コントロール').length).toBeGreaterThanOrEqual(2)
    // 使い終わったセッションは破棄される
    expect(セッションモック.destroy).toHaveBeenCalled()
  })

  it('判定に失敗したらエラーメッセージを表示する', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('available')
    セッションモック.judgeEnglishOrigin.mockRejectedValue(new Error('モデルの呼び出しに失敗'))
    render(<App />)

    await userEvent.type(await screen.findByRole('textbox'), 'コントロール')
    await userEvent.click(screen.getByRole('button', { name: '判定する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('モデルの呼び出しに失敗')
  })

  it('保存済みの履歴を起動時に表示し、クリアできる', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('available')
    addHistoryEntry(
      {
        input: 'クラフト',
        verdict: 'english',
        englishWord: 'craft',
        note: '',
        dictionary: { exists: true, phonetic: null, meanings: [] },
        explanation: '解説',
        examples: [],
      },
      1000,
    )
    render(<App />)

    expect(await screen.findByText('クラフト')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '履歴をクリア' }))

    expect(screen.queryByText('クラフト')).not.toBeInTheDocument()
    expect(screen.getByText('まだ履歴がありません')).toBeInTheDocument()
  })
})
