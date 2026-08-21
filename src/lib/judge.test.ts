/**
 * judge.ts（判定パイプラインのオーケストレーション）のテスト。
 *
 * Gemini Nano・辞書 API への依存はすべて注入されたモックで置き換え、
 * 「英語由来判定 → 辞書チェック → 解説 → 例文」の流れと
 * 各分岐（英語 / 英語でない / 辞書に無い）を検証します。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_COMPOUND_PARTS, judgeWord, type JudgeDeps } from './judge'

const 依存モック = {
  judgeEnglishOrigin: vi.fn(),
  lookupEnglishWord: vi.fn(),
  explainWord: vi.fn(),
  makeExampleSentences: vi.fn(),
  onStep: vi.fn(),
  onProgress: vi.fn(),
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
      inputType: 'single_word',
      isEnglishOrigin: true,
      englishWord: 'control',
      parts: [],
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
      inputType: 'single_word',
      isEnglishOrigin: false,
      englishWord: null,
      parts: [],
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
      inputType: 'single_word',
      isEnglishOrigin: true,
      englishWord: 'sarariman',
      parts: [],
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
      inputType: 'single_word',
      isEnglishOrigin: true,
      englishWord: null,
      parts: [],
      note: '',
    })

    const 結果 = await judgeWord('あいまい', 依存モック)

    expect(結果.verdict).toBe('not_english')
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('入力の前後の空白を取り除いて判定する', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'single_word',
      isEnglishOrigin: false,
      englishWord: null,
      parts: [],
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
      inputType: 'single_word',
      isEnglishOrigin: true,
      englishWord: 'control',
      parts: [],
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

  it('英語の場合、辞書チェック後と解説生成後に途中結果を onProgress で通知する', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'single_word',
      isEnglishOrigin: true,
      englishWord: 'control',
      parts: [],
      note: '英語の control が語源です。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ヒット結果)
    依存モック.explainWord.mockResolvedValue('control は「制御」を意味します。')
    依存モック.makeExampleSentences.mockResolvedValue(例文リスト)

    await judgeWord('コントロール', 依存モック)

    // 1回目: 辞書チェック完了時点（verdict は確定済み・解説と例文は未生成）
    expect(依存モック.onProgress).toHaveBeenNthCalledWith(1, {
      input: 'コントロール',
      verdict: 'english',
      englishWord: 'control',
      note: '英語の control が語源です。',
      dictionary: 辞書ヒット結果,
      explanation: null,
      examples: [],
    })
    // 2回目: 解説生成完了時点（例文のみ未生成）
    expect(依存モック.onProgress).toHaveBeenNthCalledWith(2, {
      input: 'コントロール',
      verdict: 'english',
      englishWord: 'control',
      note: '英語の control が語源です。',
      dictionary: 辞書ヒット結果,
      explanation: 'control は「制御」を意味します。',
      examples: [],
    })
    // 最終結果は戻り値で返すため、通知は上記の2回のみ
    expect(依存モック.onProgress).toHaveBeenCalledTimes(2)

    // 通知は次フェーズの開始前に行われる（完了後にまとめて通知しない）
    expect(依存モック.onProgress.mock.invocationCallOrder[0]).toBeLessThan(
      依存モック.explainWord.mock.invocationCallOrder[0],
    )
    expect(依存モック.onProgress.mock.invocationCallOrder[1]).toBeLessThan(
      依存モック.makeExampleSentences.mock.invocationCallOrder[0],
    )
  })

  it('途中で確定するケース（英語でない・辞書に無い）では onProgress を呼ばない', async () => {
    // 英語でない場合: 由来判定の時点で最終結果が確定するため、途中結果は存在しない
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'single_word',
      isEnglishOrigin: false,
      englishWord: null,
      parts: [],
      note: '日本語固有の擬態語です。',
    })
    await judgeWord('もちもち', 依存モック)
    expect(依存モック.onProgress).not.toHaveBeenCalled()

    // 辞書に無い場合: 辞書チェックの時点で最終結果が確定するため、途中結果は存在しない
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'single_word',
      isEnglishOrigin: true,
      englishWord: 'sarariman',
      parts: [],
      note: '和製英語の可能性があります。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue({ exists: false, phonetic: null, meanings: [] })
    await judgeWord('サラリーマン', 依存モック)
    expect(依存モック.onProgress).not.toHaveBeenCalled()
  })
})

describe('judgeWord: 複合語の判定', () => {
  /** 「アルミサッシ」: 全体は辞書に無いが、パーツはどちらも実在する英単語 */
  const アルミサッシ由来判定 = {
    inputType: 'compound' as const,
    isEnglishOrigin: true,
    englishWord: 'aluminum sash',
    parts: [
      { japanese: 'アルミ', englishWord: 'aluminium' },
      { japanese: 'サッシ', englishWord: 'sash' },
    ],
    note: '英単語を組み合わせた複合語です。',
  }

  const アルミの辞書結果 = {
    exists: true,
    phonetic: null,
    meanings: [{ partOfSpeech: 'noun', definition: 'A silvery-white metal.' }],
  }
  const サッシの辞書結果 = {
    exists: true,
    phonetic: null,
    meanings: [{ partOfSpeech: 'noun', definition: 'A window frame.' }],
  }
  const 辞書ミス結果 = { exists: false, phonetic: null, meanings: [] }

  it('全体は辞書に無くても、パーツに実在する英単語が含まれれば english_compound を返す', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue(アルミサッシ由来判定)
    依存モック.lookupEnglishWord.mockImplementation(async (単語: string) => {
      if (単語 === 'aluminium') return アルミの辞書結果
      if (単語 === 'sash') return サッシの辞書結果
      return 辞書ミス結果 // 全体の 'aluminum sash' は辞書に無い
    })

    const 結果 = await judgeWord('アルミサッシ', 依存モック)

    expect(結果).toEqual({
      input: 'アルミサッシ',
      verdict: 'english_compound',
      englishWord: 'aluminum sash',
      note: '英単語を組み合わせた複合語です。',
      dictionary: 辞書ミス結果,
      explanation: null,
      examples: [],
      parts: [
        { japanese: 'アルミ', englishWord: 'aluminium', dictionary: アルミの辞書結果 },
        { japanese: 'サッシ', englishWord: 'sash', dictionary: サッシの辞書結果 },
      ],
    })
    // 全体 + パーツ 2 つの計 3 回照会する
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(3)
    // 解説・例文は複合語では生成しない
    expect(依存モック.explainWord).not.toHaveBeenCalled()
    expect(依存モック.makeExampleSentences).not.toHaveBeenCalled()
  })

  it('複合語でも全体が辞書に実在すれば従来どおり english を優先する', async () => {
    // 「アイスクリーム」のように複合語全体がひとつの英語表現として実在するケース
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'compound',
      isEnglishOrigin: true,
      englishWord: 'ice cream',
      parts: [
        { japanese: 'アイス', englishWord: 'ice' },
        { japanese: 'クリーム', englishWord: 'cream' },
      ],
      note: '英語の ice cream が語源です。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ヒット結果)
    依存モック.explainWord.mockResolvedValue('解説')
    依存モック.makeExampleSentences.mockResolvedValue(例文リスト)

    const 結果 = await judgeWord('アイスクリーム', 依存モック)

    expect(結果.verdict).toBe('english')
    expect(結果.parts).toBeUndefined()
    // 全体で確定するため、パーツごとの辞書照会は行わない
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledWith('ice cream')
  })

  it('全体は英語由来でなくても、英語のパーツが辞書に実在すれば english_compound を返す', async () => {
    // 「窓サッシ」: 全体としては日本語扱いだが「サッシ」は英語 sash に対応する
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'compound',
      isEnglishOrigin: false,
      englishWord: null,
      parts: [
        { japanese: '窓', englishWord: null },
        { japanese: 'サッシ', englishWord: 'sash' },
      ],
      note: '日本語とカタカナ語の複合語です。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue(サッシの辞書結果)

    const 結果 = await judgeWord('窓サッシ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(結果.parts).toEqual([
      { japanese: '窓', englishWord: null, dictionary: null },
      { japanese: 'サッシ', englishWord: 'sash', dictionary: サッシの辞書結果 },
    ])
    // 英語に対応しないパーツ（窓）は辞書照会しない
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledWith('sash')
  })

  it('全体の英単語がパーツ 1 つの英単語と同じ場合は全体照会せずパーツ判定する', async () => {
    // 実機で確認した誤判定の再現: モデルが複合語全体の英語表現ではなく
    // 「サッシ」の分だけの sash を englishWord に返すと、全体照会で sash が
    // 辞書ヒットして「アルミサッシ＝英語(sash)」になってしまう
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'compound',
      isEnglishOrigin: true,
      englishWord: 'sash',
      parts: [
        { japanese: 'アルミ', englishWord: 'aluminium' },
        { japanese: 'サッシ', englishWord: 'sash' },
      ],
      note: '英語の sash が語源の複合語です。',
    })
    依存モック.lookupEnglishWord.mockImplementation(async (単語: string) => {
      if (単語 === 'aluminium') return アルミの辞書結果
      if (単語 === 'sash') return サッシの辞書結果
      return 辞書ミス結果
    })

    const 結果 = await judgeWord('アルミサッシ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    // 一部のパーツだけを表す英単語は複合語全体の対応語として表示しない
    expect(結果.englishWord).toBeNull()
    expect(結果.parts).toEqual([
      { japanese: 'アルミ', englishWord: 'aluminium', dictionary: アルミの辞書結果 },
      { japanese: 'サッシ', englishWord: 'sash', dictionary: サッシの辞書結果 },
    ])
    // 全体照会はスキップし、パーツ 2 つ分だけ照会する
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(2)
    expect(依存モック.explainWord).not.toHaveBeenCalled()
    expect(依存モック.makeExampleSentences).not.toHaveBeenCalled()
    // 全体照会が無いため checking_dictionary は通知しない
    expect(依存モック.onStep.mock.calls.map((呼び出し) => 呼び出し[0])).toEqual([
      'judging_origin',
      'checking_parts',
    ])
  })

  it('パーツの英単語がどれも辞書に無ければ従来の not_in_dictionary にフォールバックする', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue(アルミサッシ由来判定)
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ミス結果)

    const 結果 = await judgeWord('アルミサッシ', 依存モック)

    expect(結果.verdict).toBe('not_in_dictionary')
    expect(結果.englishWord).toBe('aluminum sash')
    expect(結果.parts).toBeUndefined()
  })

  it('英語由来のパーツがひとつも無い複合語は辞書照会せず not_english を返す', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'compound',
      isEnglishOrigin: false,
      englishWord: null,
      parts: [
        { japanese: '手', englishWord: null },
        { japanese: '紙', englishWord: null },
      ],
      note: '日本語固有の言葉です。',
    })

    const 結果 = await judgeWord('手紙', 依存モック)

    expect(結果.verdict).toBe('not_english')
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('パーツが 1 つしか無い場合は複合語として扱わず従来の判定に任せる', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'compound',
      isEnglishOrigin: false,
      englishWord: null,
      parts: [{ japanese: 'もちもち', englishWord: null }],
      note: '日本語固有の擬態語です。',
    })

    const 結果 = await judgeWord('もちもち', 依存モック)

    expect(結果.verdict).toBe('not_english')
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('パーツの辞書照会は MAX_COMPOUND_PARTS 個までに制限する', async () => {
    // 判定時間が伸びすぎないよう、先頭から MAX_COMPOUND_PARTS 個だけを対象にする
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'compound',
      isEnglishOrigin: false,
      englishWord: null,
      parts: [
        { japanese: 'ワン', englishWord: 'one' },
        { japanese: 'ツー', englishWord: 'two' },
        { japanese: 'スリー', englishWord: 'three' },
        { japanese: 'フォー', englishWord: 'four' },
        { japanese: 'ファイブ', englishWord: 'five' },
        { japanese: 'シックス', englishWord: 'six' },
      ],
      note: '英数字を並べた複合語です。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue(サッシの辞書結果)

    const 結果 = await judgeWord('ワンツースリーフォーファイブシックス', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(結果.parts).toHaveLength(MAX_COMPOUND_PARTS)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(MAX_COMPOUND_PARTS)
  })

  it('複合語の判定では onStep を判定→辞書→パーツ確認の順に通知し、onProgress は呼ばない', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue(アルミサッシ由来判定)
    依存モック.lookupEnglishWord.mockImplementation(async (単語: string) => {
      if (単語 === 'aluminium') return アルミの辞書結果
      if (単語 === 'sash') return サッシの辞書結果
      return 辞書ミス結果
    })

    await judgeWord('アルミサッシ', 依存モック)

    expect(依存モック.onStep.mock.calls.map((呼び出し) => 呼び出し[0])).toEqual([
      'judging_origin',
      'checking_dictionary',
      'checking_parts',
    ])
    // english_compound はパーツ確認の時点で結果が確定するため、途中結果は存在しない
    expect(依存モック.onProgress).not.toHaveBeenCalled()
  })
})

describe('judgeWord: 文章の入力', () => {
  it('文章と判定された入力はエラーを投げて単語での入力を案内する（fail-fast）', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'sentence',
      isEnglishOrigin: false,
      englishWord: null,
      parts: [],
      note: '文章です。',
    })

    await expect(judgeWord('これはペンです', 依存モック)).rejects.toThrow(
      '文章の判定には対応していません',
    )
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })
})
