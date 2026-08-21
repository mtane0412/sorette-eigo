/**
 * App（アプリ全体の統合）のテスト。
 *
 * Gemini Nano ラッパーと辞書 API をモジュールモックで置き換え、
 * 「可用性チェック → モデル準備 → 判定 → 結果表示 → 履歴保存」の
 * 一連の流れを検証します。localStorage は jsdom の実装をそのまま使います。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { checkAvailability, createNanoSession, type NanoSession } from './lib/geminiNano'
import { lookupEnglishWord } from './lib/dictionary'
import { analyzeMorphemes } from './lib/morphology'
import { addHistoryEntry } from './lib/history'
import type { ExampleSentence } from './types'

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

vi.mock('./lib/morphology', async (importOriginal) => {
  const 元モジュール = await importOriginal<typeof import('./lib/morphology')>()
  return {
    ...元モジュール,
    analyzeMorphemes: vi.fn(),
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
  // 判定テストの入力「コントロール」は単一の形態素として扱う
  vi.mocked(analyzeMorphemes).mockResolvedValue([{ surface: 'コントロール', pos: '名詞' }])
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
  it('サービス名「それってエイゴ？」を見出しに表示する', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('available')
    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 1, name: /それってエイゴ？/ }),
    ).toBeInTheDocument()
  })

  it('GitHub リポジトリへのリンクを表示する', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('available')
    render(<App />)

    const リンク = await screen.findByRole('link', { name: 'GitHub リポジトリ' })
    expect(リンク).toHaveAttribute('href', 'https://github.com/mtane0412/sorette-eigo')
  })

  it('小型モデルの判定結果を鵜呑みにしないよう促す注意書きを表示する', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('available')
    render(<App />)

    expect(
      await screen.findByText(/小型のAIモデルによる判定のため、間違えることがあります/),
    ).toBeInTheDocument()
  })

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

  it('判定の途中経過を段階的に表示する（スタンプ → 解説 → 例文）', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('available')
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
    // 解説・例文の生成は手動で完了させ、フェーズごとの表示を検証できるようにする
    let 解説を返す!: (解説: string) => void
    セッションモック.explainWord.mockReturnValue(
      new Promise<string>((resolve) => {
        解説を返す = resolve
      }),
    )
    let 例文を返す!: (例文: ExampleSentence[]) => void
    セッションモック.makeExampleSentences.mockReturnValue(
      new Promise<ExampleSentence[]>((resolve) => {
        例文を返す = resolve
      }),
    )
    render(<App />)

    await userEvent.type(await screen.findByRole('textbox'), 'コントロール')
    await userEvent.click(screen.getByRole('button', { name: '判定する' }))

    // 辞書チェック完了時点: スタンプと英単語は表示済み、解説・例文はまだ
    expect(await screen.findByText('英語です！')).toBeInTheDocument()
    expect(screen.getByText('control')).toBeInTheDocument()
    expect(screen.queryByText('解説')).not.toBeInTheDocument()
    expect(screen.getByText('解説を生成中…')).toBeInTheDocument()

    // 解説の生成完了: 解説が追加表示され、例文はまだ
    await act(async () => {
      解説を返す('control は「制御」を意味します。')
    })
    expect(await screen.findByText('control は「制御」を意味します。')).toBeInTheDocument()
    expect(screen.queryByText('I can control it.')).not.toBeInTheDocument()
    expect(screen.getByText('例文を作成中…')).toBeInTheDocument()

    // 例文の生成完了: 例文まで表示され、プログレス表示が消える
    await act(async () => {
      例文を返す([
        { english: 'I can control it.', japanese: '私はそれをコントロールできます。' },
      ])
    })
    expect(await screen.findByText('I can control it.')).toBeInTheDocument()
    expect(screen.queryByText('例文を作成中…')).not.toBeInTheDocument()
  })

  it('例文の生成に失敗しても、それまでの途中結果とエラーを両方表示する', async () => {
    vi.mocked(checkAvailability).mockResolvedValue('available')
    英語判定が成功するように仕込む()
    セッションモック.makeExampleSentences.mockRejectedValue(new Error('例文の生成に失敗'))
    render(<App />)

    await userEvent.type(await screen.findByRole('textbox'), 'コントロール')
    await userEvent.click(screen.getByRole('button', { name: '判定する' }))

    // エラーは表示しつつ、確定済みの判定と解説は消さずに残す
    expect(await screen.findByRole('alert')).toHaveTextContent('例文の生成に失敗')
    expect(screen.getByText('英語です！')).toBeInTheDocument()
    expect(screen.getByText('control は「制御」を意味します。')).toBeInTheDocument()
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
