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
  /** 「アルミサッシ」の全体判定: 全体は aluminum sash（辞書に無い）、パーツはアルミ・サッシ */
  const アルミサッシ全体判定 = {
    inputType: 'compound' as const,
    isEnglishOrigin: true,
    englishWord: 'aluminum sash',
    parts: ['アルミ', 'サッシ'],
    note: '英単語を組み合わせた複合語です。',
  }
  /** パーツ「アルミ」単体の従来判定 */
  const アルミ単体判定 = {
    inputType: 'single_word' as const,
    isEnglishOrigin: true,
    englishWord: 'aluminium',
    parts: [],
    note: '英語の aluminium が語源です。',
  }
  /** パーツ「サッシ」単体の従来判定 */
  const サッシ単体判定 = {
    inputType: 'single_word' as const,
    isEnglishOrigin: true,
    englishWord: 'sash',
    parts: [],
    note: '英語の sash が語源です。',
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

  /** 「アルミサッシ」用の語源判定モック（全体→パーツの順に呼ばれる） */
  const アルミサッシの語源判定モックを用意する = (全体判定 = アルミサッシ全体判定) => {
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'アルミサッシ') return 全体判定
      if (単語 === 'アルミ') return アルミ単体判定
      if (単語 === 'サッシ') return サッシ単体判定
      throw new Error(`想定外の判定対象: ${単語}`)
    })
  }

  /** アルミ・サッシは辞書に実在し、それ以外（全体の aluminum sash）は無い辞書モック */
  const アルミサッシの辞書モックを用意する = () => {
    依存モック.lookupEnglishWord.mockImplementation(async (単語: string) => {
      if (単語 === 'aluminium') return アルミの辞書結果
      if (単語 === 'sash') return サッシの辞書結果
      return 辞書ミス結果
    })
  }

  it('全体は辞書に無くても、パーツごとの従来判定で実在する英単語が確認できれば english_compound を返す', async () => {
    アルミサッシの語源判定モックを用意する()
    アルミサッシの辞書モックを用意する()

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
    // 語源判定は全体 1 回 + パーツ 2 回
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(3)
    // 辞書照会は全体 + パーツ 2 つの計 3 回
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
      parts: ['アイス', 'クリーム'],
      note: '英語の ice cream が語源です。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ヒット結果)
    依存モック.explainWord.mockResolvedValue('解説')
    依存モック.makeExampleSentences.mockResolvedValue(例文リスト)

    const 結果 = await judgeWord('アイスクリーム', 依存モック)

    expect(結果.verdict).toBe('english')
    expect(結果.parts).toBeUndefined()
    // 全体で確定するため、パーツごとの語源判定・辞書照会は行わない
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledWith('ice cream')
  })

  it('複合語なのに全体の英単語が 1 語だけの場合は全体照会せずパーツ判定する', async () => {
    // 実機で確認した誤判定の再現: モデルが複合語全体の英語表現ではなく
    // 「サッシ」の分だけの sash を englishWord に返すと、全体照会で sash が
    // 辞書ヒットして「アルミサッシ＝英語(sash)」になってしまう。
    // 2 パーツ以上に対応する英語表現は通常 2 語以上になるため、1 語だけなら信用しない
    アルミサッシの語源判定モックを用意する({ ...アルミサッシ全体判定, englishWord: 'sash' })
    アルミサッシの辞書モックを用意する()

    const 結果 = await judgeWord('アルミサッシ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    // 信用できない全体の英単語は複合語全体の対応語として表示しない
    expect(結果.englishWord).toBeNull()
    expect(結果.parts).toEqual([
      { japanese: 'アルミ', englishWord: 'aluminium', dictionary: アルミの辞書結果 },
      { japanese: 'サッシ', englishWord: 'sash', dictionary: サッシの辞書結果 },
    ])
    // 全体照会はスキップし、パーツ 2 つ分だけ照会する
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(2)
    // 全体照会が無いため checking_dictionary は通知しない
    expect(依存モック.onStep.mock.calls.map((呼び出し) => 呼び出し[0])).toEqual([
      'judging_origin',
      'checking_parts',
    ])
  })

  it('英語由来でないカタカナのパーツは、パーツ単体の従来判定で除外する', async () => {
    // 「パンナイフ」: パンはポルトガル語由来なので、パーツ単体の語源判定（enum 分類）で
    // 英語由来ではないと判定され、対訳（bread）が紛れ込まない
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'パンナイフ') {
        return {
          inputType: 'compound',
          isEnglishOrigin: false,
          englishWord: null,
          parts: ['パン', 'ナイフ'],
          note: '外来語を組み合わせた複合語です。',
        }
      }
      if (単語 === 'パン') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: false,
          englishWord: null,
          parts: [],
          note: 'ポルトガル語由来です。',
        }
      }
      if (単語 === 'ナイフ') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: true,
          englishWord: 'knife',
          parts: [],
          note: '英語の knife が語源です。',
        }
      }
      throw new Error(`想定外の判定対象: ${単語}`)
    })
    依存モック.lookupEnglishWord.mockResolvedValue(サッシの辞書結果)

    const 結果 = await judgeWord('パンナイフ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(結果.parts).toEqual([
      { japanese: 'パン', englishWord: null, dictionary: null },
      { japanese: 'ナイフ', englishWord: 'knife', dictionary: サッシの辞書結果 },
    ])
    // 英語由来でないパーツ（パン）は辞書照会しない
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledWith('knife')
  })

  it('パーツの英単語がどれも辞書に無ければ従来の not_in_dictionary にフォールバックする', async () => {
    アルミサッシの語源判定モックを用意する()
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ミス結果)

    const 結果 = await judgeWord('アルミサッシ', 依存モック)

    expect(結果.verdict).toBe('not_in_dictionary')
    expect(結果.englishWord).toBe('aluminum sash')
    expect(結果.parts).toBeUndefined()
  })

  it('カタカナ・英字を含むパーツがひとつも無い複合語は、パーツ判定せず not_english を返す', async () => {
    // 「手紙」: 英語の外来語は原則カタカナ・英字表記なので、漢字のみのパーツは判定不要
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'compound',
      isEnglishOrigin: false,
      englishWord: null,
      parts: ['手', '紙'],
      note: '日本語固有の言葉です。',
    })

    const 結果 = await judgeWord('手紙', 依存モック)

    expect(結果.verdict).toBe('not_english')
    // 語源判定は全体の 1 回だけで、パーツの推論・辞書照会は行わない
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('パーツが 1 つしか無い場合は複合語として扱わず従来の判定に任せる', async () => {
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      inputType: 'compound',
      isEnglishOrigin: false,
      englishWord: null,
      parts: ['もちもち'],
      note: '日本語固有の擬態語です。',
    })

    const 結果 = await judgeWord('もちもち', 依存モック)

    expect(結果.verdict).toBe('not_english')
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('パーツの判定は MAX_COMPOUND_PARTS 個までに制限する', async () => {
    // オンデバイス推論はパーツごとに数秒かかるため、先頭から MAX_COMPOUND_PARTS 個だけを対象にする
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'ワンツースリーフォーファイブシックス') {
        return {
          inputType: 'compound',
          isEnglishOrigin: false,
          englishWord: null,
          parts: ['ワン', 'ツー', 'スリー', 'フォー', 'ファイブ', 'シックス'],
          note: '英数字を並べた複合語です。',
        }
      }
      return {
        inputType: 'single_word',
        isEnglishOrigin: true,
        englishWord: 'one',
        parts: [],
        note: '英語の数字です。',
      }
    })
    依存モック.lookupEnglishWord.mockResolvedValue(サッシの辞書結果)

    const 結果 = await judgeWord('ワンツースリーフォーファイブシックス', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(結果.parts).toHaveLength(MAX_COMPOUND_PARTS)
    // 語源判定は全体 1 回 + パーツ MAX_COMPOUND_PARTS 回
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(1 + MAX_COMPOUND_PARTS)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(MAX_COMPOUND_PARTS)
  })

  it('複合語の判定では onStep を判定→辞書→パーツ確認の順に通知する', async () => {
    アルミサッシの語源判定モックを用意する()
    アルミサッシの辞書モックを用意する()

    await judgeWord('アルミサッシ', 依存モック)

    expect(依存モック.onStep.mock.calls.map((呼び出し) => 呼び出し[0])).toEqual([
      'judging_origin',
      'checking_dictionary',
      'checking_parts',
    ])
  })

  it('verdict の確定後は、パーツが完了するたびに途中結果を onProgress で通知する', async () => {
    // アルミ（1 つ目）が辞書に実在した時点で english_compound が確定するため、
    // 最後のパーツ（サッシ）を判定する前に、完了済みのパーツだけで途中結果を通知する
    アルミサッシの語源判定モックを用意する()
    アルミサッシの辞書モックを用意する()

    await judgeWord('アルミサッシ', 依存モック)

    expect(依存モック.onProgress).toHaveBeenCalledTimes(1)
    expect(依存モック.onProgress).toHaveBeenCalledWith({
      input: 'アルミサッシ',
      verdict: 'english_compound',
      englishWord: 'aluminum sash',
      note: '英単語を組み合わせた複合語です。',
      dictionary: 辞書ミス結果,
      explanation: null,
      examples: [],
      parts: [{ japanese: 'アルミ', englishWord: 'aluminium', dictionary: アルミの辞書結果 }],
    })
  })

  it('最初のパーツが辞書に無い場合、verdict が未確定の間は onProgress を呼ばない', async () => {
    // アルミが辞書に無く、最後のサッシで初めて確定するケース: 途中通知は無く戻り値だけで返す
    アルミサッシの語源判定モックを用意する()
    依存モック.lookupEnglishWord.mockImplementation(async (単語: string) => {
      if (単語 === 'sash') return サッシの辞書結果
      return 辞書ミス結果
    })

    const 結果 = await judgeWord('アルミサッシ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(依存モック.onProgress).not.toHaveBeenCalled()
  })
})

describe('judgeWord: 語種が混在する入力（漢字・ひらがな + カタカナ・英字）', () => {
  const サッシの辞書結果 = {
    exists: true,
    phonetic: null,
    meanings: [{ partOfSpeech: 'noun', definition: 'A window frame.' }],
  }
  const アルミの辞書結果 = {
    exists: true,
    phonetic: null,
    meanings: [{ partOfSpeech: 'noun', definition: 'A silvery-white metal.' }],
  }

  it('モデルが複合語と判定しなくても、機械分割してパーツ判定する', async () => {
    // 実機で確認した誤判定の再現: モデルが「窓サッシ」を分解せず englishWord に
    // sash だけを返すと、全体照会で sash が辞書ヒットして「窓サッシ＝英語」になってしまう。
    // 漢字とカタカナが混在する入力は、全体がひとつの英語の外来語ではあり得ない
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === '窓サッシ') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: true,
          englishWord: 'sash',
          parts: [],
          note: 'サッシは英語の sash に由来します。',
        }
      }
      if (単語 === 'サッシ') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: true,
          englishWord: 'sash',
          parts: [],
          note: '英語の sash が語源です。',
        }
      }
      throw new Error(`想定外の判定対象: ${単語}`)
    })
    依存モック.lookupEnglishWord.mockResolvedValue(サッシの辞書結果)

    const 結果 = await judgeWord('窓サッシ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(結果.parts).toEqual([
      { japanese: '窓', englishWord: null, dictionary: null },
      { japanese: 'サッシ', englishWord: 'sash', dictionary: サッシの辞書結果 },
    ])
    // 混在入力では全体の英単語を信用できないため、複合語全体の対応語として表示しない
    expect(結果.englishWord).toBeNull()
    // 語源判定は全体 1 回 + カタカナのパーツ（サッシ）1 回。漢字のみの窓は推論しない
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(2)
    // 全体照会はせず、パーツ（sash）の 1 回だけ照会する
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledWith('sash')
    expect(依存モック.onStep.mock.calls.map((呼び出し) => 呼び出し[0])).toEqual([
      'judging_origin',
      'checking_parts',
    ])
  })

  it('英語由来のパーツが無ければ従来どおり not_english を返す', async () => {
    // 「パン工場」: パンはポルトガル語由来・工場は日本語なので英語は含まれない。
    // パンはパーツ単体の従来判定（enum 分類）で英語由来ではないと判定される
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'パン工場') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: false,
          englishWord: null,
          parts: [],
          note: 'ポルトガル語由来',
        }
      }
      if (単語 === 'パン') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: false,
          englishWord: null,
          parts: [],
          note: 'ポルトガル語由来です。',
        }
      }
      throw new Error(`想定外の判定対象: ${単語}`)
    })

    const 結果 = await judgeWord('パン工場', 依存モック)

    expect(結果.verdict).toBe('not_english')
    // カタカナのパーツ（パン）は従来判定にかけるが、辞書照会には至らない
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(2)
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('カタカナのパーツが複数あっても、それぞれ従来判定して english_compound を返す', async () => {
    // 「アルミ製サッシ」: パーツごとに従来判定するため、全体の英単語の
    // 紐付けに頼らず アルミ・サッシ の両方を判定できる
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'アルミ製サッシ') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: true,
          englishWord: 'sash',
          parts: [],
          note: '英語の sash に由来します。',
        }
      }
      if (単語 === 'アルミ') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: true,
          englishWord: 'aluminium',
          parts: [],
          note: '英語の aluminium が語源です。',
        }
      }
      if (単語 === 'サッシ') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: true,
          englishWord: 'sash',
          parts: [],
          note: '英語の sash が語源です。',
        }
      }
      throw new Error(`想定外の判定対象: ${単語}`)
    })
    依存モック.lookupEnglishWord.mockImplementation(async (単語: string) => {
      if (単語 === 'aluminium') return アルミの辞書結果
      if (単語 === 'sash') return サッシの辞書結果
      return { exists: false, phonetic: null, meanings: [] }
    })

    const 結果 = await judgeWord('アルミ製サッシ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(結果.parts).toEqual([
      { japanese: 'アルミ', englishWord: 'aluminium', dictionary: アルミの辞書結果 },
      { japanese: '製', englishWord: null, dictionary: null },
      { japanese: 'サッシ', englishWord: 'sash', dictionary: サッシの辞書結果 },
    ])
    // 語源判定は全体 1 回 + カタカナのパーツ 2 回（漢字のみの製は推論しない）
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(3)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(2)
  })

  it('モデルがパーツを返した場合は機械分割ではなくモデルの分解を使う', async () => {
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === '窓サッシ') {
        return {
          inputType: 'compound',
          isEnglishOrigin: false,
          englishWord: null,
          parts: ['窓', 'サッシ'],
          note: '日本語とカタカナ語の複合語です。',
        }
      }
      if (単語 === 'サッシ') {
        return {
          inputType: 'single_word',
          isEnglishOrigin: true,
          englishWord: 'sash',
          parts: [],
          note: '英語の sash が語源です。',
        }
      }
      throw new Error(`想定外の判定対象: ${単語}`)
    })
    依存モック.lookupEnglishWord.mockResolvedValue(サッシの辞書結果)

    const 結果 = await judgeWord('窓サッシ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(結果.parts).toEqual([
      { japanese: '窓', englishWord: null, dictionary: null },
      { japanese: 'サッシ', englishWord: 'sash', dictionary: サッシの辞書結果 },
    ])
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
