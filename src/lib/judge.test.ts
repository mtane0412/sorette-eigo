/**
 * judge.ts（判定パイプラインのオーケストレーション）のテスト。
 *
 * Gemini Nano・辞書 API への依存はすべて注入されたモックで置き換え、
 * 「英語由来判定 → 辞書チェック → 解説 → 例文」の流れと
 * 各分岐（英語 / 英語でない / 辞書に無い）を検証します。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { judgeWord, type JudgeDeps } from './judge'

const 依存モック = {
  judgeEnglishOrigin: vi.fn(),
  lookupEnglishWord: vi.fn(),
  explainWord: vi.fn(),
  makeExampleSentences: vi.fn(),
  onStep: vi.fn(),
} satisfies JudgeDeps

const 辞書ヒット結果 = {
  exists: true,
  phonetic: '/kənˈtɹəʊl/',
  meanings: [{ partOfSpeech: 'noun', definition: 'The ability to influence.' }],
}

const 例文リスト = [
  { english: 'I can control it.', japanese: '私はそれをコントロールできます。' },
  { english: 'Stay in control.', japanese: '冷静さを保ちなさい。' },
  { english: 'The remote control is broken.', japanese: 'リモコンが壊れています。' },
]

beforeEach(() => {
  vi.resetAllMocks()
})

describe('judgeWord', () => {
  it('英語由来かつ辞書に実在する場合は verdict: english と解説・例文を返す', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: true,
      englishWord: 'control',
      note: '英語の control が語源です。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ヒット結果)
    依存モック.explainWord.mockResolvedValue('control は「制御」を意味します。')
    依存モック.makeExampleSentences.mockResolvedValue(例文リスト)

    const 結果 = await judgeWord('コントロール', 依存モック)

    expect(結果).toEqual({
      input: 'コントロール',
      verdict: 'english',
      englishWord: 'control',
      note: '英語の control が語源です。',
      dictionary: 辞書ヒット結果,
      explanation: 'control は「制御」を意味します。',
      examples: 例文リスト,
    })
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledWith('control')
    expect(依存モック.explainWord).toHaveBeenCalledWith('control', 'コントロール')
    expect(依存モック.makeExampleSentences).toHaveBeenCalledWith('control')
  })

  it('英語由来でない場合は verdict: not_english を返し、辞書・解説は呼ばない', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: false,
      englishWord: null,
      note: '日本語固有の擬態語です。',
    })

    const 結果 = await judgeWord('もちもち', 依存モック)

    expect(結果.verdict).toBe('not_english')
    expect(結果.englishWord).toBeNull()
    expect(結果.dictionary).toBeNull()
    expect(結果.explanation).toBeNull()
    expect(結果.examples).toEqual([])
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
    expect(依存モック.explainWord).not.toHaveBeenCalled()
    expect(依存モック.makeExampleSentences).not.toHaveBeenCalled()
  })

  it('英語由来と推定されたが辞書に無い場合は verdict: not_in_dictionary を返す', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: true,
      englishWord: 'sarariman',
      note: '和製英語の可能性があります。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue({ exists: false, phonetic: null, meanings: [] })

    const 結果 = await judgeWord('サラリーマン', 依存モック)

    expect(結果.verdict).toBe('not_in_dictionary')
    expect(結果.englishWord).toBe('sarariman')
    expect(結果.dictionary).toEqual({ exists: false, phonetic: null, meanings: [] })
    expect(結果.explanation).toBeNull()
    expect(結果.examples).toEqual([])
    expect(依存モック.explainWord).not.toHaveBeenCalled()
  })

  it('isEnglishOrigin: true でも英単語が空なら not_english として扱う', async () => {
    // モデル出力の矛盾（由来ありなのに単語なし）は辞書確認ができないため英語と断定しない
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: true,
      englishWord: null,
      note: '',
    })

    const 結果 = await judgeWord('あいまい', 依存モック)

    expect(結果.verdict).toBe('not_english')
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('入力の前後の空白を取り除いて判定する', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: false,
      englishWord: null,
      note: '',
    })

    const 結果 = await judgeWord('  もちもち  ', 依存モック)

    expect(結果.input).toBe('もちもち')
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledWith('もちもち')
  })

  it('空文字・空白のみの入力はエラーを投げる（fail-fast）', async () => {
    await expect(judgeWord('   ', 依存モック)).rejects.toThrow()
    expect(依存モック.judgeEnglishOrigin).not.toHaveBeenCalled()
  })

  it('進行状況を onStep で順番に通知する（英語の場合）', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: true,
      englishWord: 'control',
      note: '',
    })
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ヒット結果)
    依存モック.explainWord.mockResolvedValue('解説')
    依存モック.makeExampleSentences.mockResolvedValue(例文リスト)

    await judgeWord('コントロール', 依存モック)

    expect(依存モック.onStep.mock.calls.map((呼び出し) => 呼び出し[0])).toEqual([
      'judging_origin',
      'checking_dictionary',
      'explaining',
      'making_examples',
    ])
  })
})
