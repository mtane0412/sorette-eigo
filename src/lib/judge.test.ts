/**
 * judge.ts（判定パイプラインのオーケストレーション）のテスト。
 *
 * 形態素解析・Gemini Nano・辞書 API への依存はすべて注入されたモックで置き換え、
 * 「形態素分解 → 語源判定 → 辞書チェック → 解説 → 例文」の流れと
 * 各分岐（単語 / 複合語 / 文章 / 英語でない / 辞書に無い）を検証します。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_COMPOUND_PARTS, judgeWord, type JudgeDeps } from './judge'

const 依存モック = {
  analyzeMorphemes: vi.fn(),
  judgeEnglishOrigin: vi.fn(),
  lookupEnglishWord: vi.fn(),
  explainWord: vi.fn(),
  makeExampleSentences: vi.fn(),
  onStep: vi.fn(),
  onProgress: vi.fn(),
} satisfies JudgeDeps

/** 名詞の形態素トークンを組み立てるヘルパー */
const 名詞 = (表記: string) => ({ surface: 表記, pos: '名詞' })

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

describe('judgeWord: 単語の判定', () => {
  it('英語由来かつ辞書に実在する場合は verdict: english と解説・例文を返す', async () => {
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('コントロール')])
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
    依存モック.analyzeMorphemes.mockResolvedValue([{ surface: 'もちもち', pos: '副詞' }])
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
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('サラリーマン')])
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
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('あいまい')])
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
    依存モック.analyzeMorphemes.mockResolvedValue([{ surface: 'もちもち', pos: '副詞' }])
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: false,
      englishWord: null,
      note: '',
    })

    const 結果 = await judgeWord('  もちもち  ', 依存モック)

    expect(結果.input).toBe('もちもち')
    expect(依存モック.analyzeMorphemes).toHaveBeenCalledWith('もちもち')
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledWith('もちもち')
  })

  it('空文字・空白のみの入力はエラーを投げる（fail-fast）', async () => {
    await expect(judgeWord('   ', 依存モック)).rejects.toThrow()
    expect(依存モック.analyzeMorphemes).not.toHaveBeenCalled()
    expect(依存モック.judgeEnglishOrigin).not.toHaveBeenCalled()
  })

  it('進行状況を onStep で順番に通知する（英語の場合）', async () => {
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('コントロール')])
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
      'analyzing_morphemes',
      'judging_origin',
      'checking_dictionary',
      'explaining',
      'making_examples',
    ])
  })

  it('英語の場合、辞書チェック後と解説生成後に途中結果を onProgress で通知する', async () => {
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('コントロール')])
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: true,
      englishWord: 'control',
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
    依存モック.analyzeMorphemes.mockResolvedValue([{ surface: 'もちもち', pos: '副詞' }])
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: false,
      englishWord: null,
      note: '日本語固有の擬態語です。',
    })
    await judgeWord('もちもち', 依存モック)
    expect(依存モック.onProgress).not.toHaveBeenCalled()

    // 辞書に無い場合: 辞書チェックの時点で最終結果が確定するため、途中結果は存在しない
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('サラリーマン')])
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: true,
      englishWord: 'sarariman',
      note: '和製英語の可能性があります。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue({ exists: false, phonetic: null, meanings: [] })
    await judgeWord('サラリーマン', 依存モック)
    expect(依存モック.onProgress).not.toHaveBeenCalled()
  })
})

describe('judgeWord: 複合語の判定', () => {
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

  /** 「アルミサッシ」用のモック（形態素分解 + パーツごとの語源判定） */
  const アルミサッシのモックを用意する = () => {
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('アルミ'), 名詞('サッシ')])
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'アルミ') {
        return { isEnglishOrigin: true, englishWord: 'aluminium', note: '英語の aluminium が語源です。' }
      }
      if (単語 === 'サッシ') {
        return { isEnglishOrigin: true, englishWord: 'sash', note: '英語の sash が語源です。' }
      }
      throw new Error(`想定外の判定対象: ${単語}`)
    })
    依存モック.lookupEnglishWord.mockImplementation(async (単語: string) => {
      if (単語 === 'aluminium') return アルミの辞書結果
      if (単語 === 'sash') return サッシの辞書結果
      return 辞書ミス結果 // 合成した全体（aluminium sash）は辞書に無い
    })
  }

  it('パーツごとに語源判定し、実在する英単語が確認できれば english_compound を返す', async () => {
    アルミサッシのモックを用意する()

    const 結果 = await judgeWord('アルミサッシ', 依存モック)

    expect(結果).toEqual({
      input: 'アルミサッシ',
      verdict: 'english_compound',
      // 全パーツが英語由来なので、パーツの英単語を結合した全体表現を表示する
      englishWord: 'aluminium sash',
      note: '',
      dictionary: 辞書ミス結果,
      explanation: null,
      examples: [],
      parts: [
        { japanese: 'アルミ', englishWord: 'aluminium', dictionary: アルミの辞書結果 },
        { japanese: 'サッシ', englishWord: 'sash', dictionary: サッシの辞書結果 },
      ],
    })
    // 語源判定はパーツ 2 回のみ（全体への判定は行わない）
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(2)
    // 辞書照会はパーツ 2 回 + 合成した全体 1 回
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(3)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledWith('aluminium sash')
    // 解説・例文は複合語では生成しない
    expect(依存モック.explainWord).not.toHaveBeenCalled()
    expect(依存モック.makeExampleSentences).not.toHaveBeenCalled()
  })

  it('全パーツが英語由来で、結合した全体表現が辞書に実在すれば english に昇格する', async () => {
    // 「アイスクリーム」: 形態素解析はアイス + クリームに分解するが、
    // ice cream はひとつの英語表現として実在するため english とする
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('アイス'), 名詞('クリーム')])
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'アイス') {
        return { isEnglishOrigin: true, englishWord: 'ice', note: '' }
      }
      if (単語 === 'クリーム') {
        return { isEnglishOrigin: true, englishWord: 'cream', note: '' }
      }
      throw new Error(`想定外の判定対象: ${単語}`)
    })
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ヒット結果)
    依存モック.explainWord.mockResolvedValue('解説')
    依存モック.makeExampleSentences.mockResolvedValue(例文リスト)

    const 結果 = await judgeWord('アイスクリーム', 依存モック)

    expect(結果.verdict).toBe('english')
    expect(結果.englishWord).toBe('ice cream')
    expect(結果.parts).toBeUndefined()
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(2)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledWith('ice cream')
    expect(依存モック.explainWord).toHaveBeenCalledWith('ice cream', 'アイスクリーム')
  })

  it('英語由来でないパーツを含む場合は全体表現へ昇格せず english_compound を返す', async () => {
    // 「パンナイフ」: パンはポルトガル語由来なので、たとえ対訳の bread knife が
    // 辞書に実在しても「パンナイフ＝英語」とはしない
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('パン'), 名詞('ナイフ')])
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'パン') {
        return { isEnglishOrigin: false, englishWord: null, note: 'ポルトガル語由来です。' }
      }
      if (単語 === 'ナイフ') {
        return { isEnglishOrigin: true, englishWord: 'knife', note: '英語の knife が語源です。' }
      }
      throw new Error(`想定外の判定対象: ${単語}`)
    })
    依存モック.lookupEnglishWord.mockResolvedValue(サッシの辞書結果)

    const 結果 = await judgeWord('パンナイフ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    // 一部のパーツだけの英単語を複合語全体の対応語として表示しない
    expect(結果.englishWord).toBeNull()
    expect(結果.parts).toEqual([
      { japanese: 'パン', englishWord: null, dictionary: null },
      { japanese: 'ナイフ', englishWord: 'knife', dictionary: サッシの辞書結果 },
    ])
    // 辞書照会は英語由来のパーツ（knife）の 1 回だけ。全体表現の照会はしない
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledWith('knife')
  })

  it('漢字・ひらがなのみのパーツは語源判定せず「英語由来ではない」として扱う', async () => {
    // 「窓サッシ」: 英語の外来語は原則カタカナ・英字表記のため、窓は推論不要
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('窓'), 名詞('サッシ')])
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'サッシ') {
        return { isEnglishOrigin: true, englishWord: 'sash', note: '英語の sash が語源です。' }
      }
      throw new Error(`想定外の判定対象: ${単語}`)
    })
    依存モック.lookupEnglishWord.mockResolvedValue(サッシの辞書結果)

    const 結果 = await judgeWord('窓サッシ', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(結果.englishWord).toBeNull()
    expect(結果.parts).toEqual([
      { japanese: '窓', englishWord: null, dictionary: null },
      { japanese: 'サッシ', englishWord: 'sash', dictionary: サッシの辞書結果 },
    ])
    // 語源判定はカタカナのパーツ（サッシ）の 1 回だけ
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(1)
    expect(依存モック.lookupEnglishWord).toHaveBeenCalledTimes(1)
  })

  it('英語由来のパーツがひとつも無ければ not_english を返す', async () => {
    // 「パン工場」: パンはポルトガル語由来・工場は日本語なので英語は含まれない
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('パン'), 名詞('工場')])
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: false,
      englishWord: null,
      note: 'ポルトガル語由来です。',
    })

    const 結果 = await judgeWord('パン工場', 依存モック)

    expect(結果.verdict).toBe('not_english')
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(1)
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledWith('パン')
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('カタカナ・英字を含むパーツがひとつも無ければ語源判定せず not_english を返す', async () => {
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('手'), 名詞('紙')])

    const 結果 = await judgeWord('手紙', 依存モック)

    expect(結果.verdict).toBe('not_english')
    expect(依存モック.judgeEnglishOrigin).not.toHaveBeenCalled()
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('英語由来のパーツがどれも辞書に無ければ not_in_dictionary を返す', async () => {
    アルミサッシのモックを用意する()
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ミス結果)

    const 結果 = await judgeWord('アルミサッシ', 依存モック)

    expect(結果.verdict).toBe('not_in_dictionary')
    // 推定された英単語として、パーツの英単語を結合した全体表現を表示する
    expect(結果.englishWord).toBe('aluminium sash')
    expect(結果.parts).toBeUndefined()
  })

  it('一部のパーツのみ英語由来で辞書に無い場合は、その英単語だけを推定として表示する', async () => {
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('パン'), 名詞('ナイフ')])
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'パン') {
        return { isEnglishOrigin: false, englishWord: null, note: '' }
      }
      return { isEnglishOrigin: true, englishWord: 'naifu', note: '' }
    })
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ミス結果)

    const 結果 = await judgeWord('パンナイフ', 依存モック)

    expect(結果.verdict).toBe('not_in_dictionary')
    expect(結果.englishWord).toBe('naifu')
  })

  it('パーツの判定は MAX_COMPOUND_PARTS 個までに制限する', async () => {
    // オンデバイス推論はパーツごとに数秒かかるため、先頭から MAX_COMPOUND_PARTS 個だけを対象にする
    依存モック.analyzeMorphemes.mockResolvedValue(
      ['ワン', 'ツー', 'スリー', 'フォー', 'ファイブ', 'シックス'].map(名詞),
    )
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: true,
      englishWord: 'one',
      note: '',
    })
    依存モック.lookupEnglishWord.mockImplementation(async (単語: string) =>
      // 合成した全体表現（スペースを含む）は辞書に無く、単語は実在する想定
      単語.includes(' ') ? 辞書ミス結果 : サッシの辞書結果,
    )

    const 結果 = await judgeWord('ワンツースリーフォーファイブシックス', 依存モック)

    expect(結果.verdict).toBe('english_compound')
    expect(結果.parts).toHaveLength(MAX_COMPOUND_PARTS)
    expect(依存モック.judgeEnglishOrigin).toHaveBeenCalledTimes(MAX_COMPOUND_PARTS)
  })

  it('複合語の判定では onStep を分解→パーツ判定→全体の辞書確認の順に通知する', async () => {
    アルミサッシのモックを用意する()

    await judgeWord('アルミサッシ', 依存モック)

    expect(依存モック.onStep.mock.calls.map((呼び出し) => 呼び出し[0])).toEqual([
      'analyzing_morphemes',
      'checking_parts',
      'checking_dictionary',
    ])
  })

  it('english への昇格があり得る間（全パーツ英語由来）は onProgress を呼ばない', async () => {
    // english_compound の途中結果を通知した後で english に変わると表示が揺れるため、
    // 昇格の可能性が消えるまでは通知しない
    アルミサッシのモックを用意する()

    await judgeWord('アルミサッシ', 依存モック)

    expect(依存モック.onProgress).not.toHaveBeenCalled()
  })

  it('昇格の可能性が消えた後は、パーツが完了するたびに途中結果を onProgress で通知する', async () => {
    // 「パンナイフセット」: パン（英語由来でない）の時点で昇格は消え、
    // ナイフの実在確認で english_compound が確定するため、途中結果を通知できる
    依存モック.analyzeMorphemes.mockResolvedValue([名詞('パン'), 名詞('ナイフ'), 名詞('セット')])
    依存モック.judgeEnglishOrigin.mockImplementation(async (単語: string) => {
      if (単語 === 'パン') {
        return { isEnglishOrigin: false, englishWord: null, note: '' }
      }
      if (単語 === 'ナイフ') {
        return { isEnglishOrigin: true, englishWord: 'knife', note: '' }
      }
      return { isEnglishOrigin: true, englishWord: 'set', note: '' }
    })
    依存モック.lookupEnglishWord.mockResolvedValue(サッシの辞書結果)

    await judgeWord('パンナイフセット', 依存モック)

    // 2 パーツ目（ナイフ）完了時点の 1 回だけ通知される（最後のセットは戻り値で返す）
    expect(依存モック.onProgress).toHaveBeenCalledTimes(1)
    expect(依存モック.onProgress).toHaveBeenCalledWith({
      input: 'パンナイフセット',
      verdict: 'english_compound',
      englishWord: null,
      note: '',
      dictionary: null,
      explanation: null,
      examples: [],
      parts: [
        { japanese: 'パン', englishWord: null, dictionary: null },
        { japanese: 'ナイフ', englishWord: 'knife', dictionary: サッシの辞書結果 },
      ],
    })
  })
})

describe('judgeWord: 文章の入力', () => {
  it('助詞・判定詞を含む入力は文章とみなしてエラーを投げる（fail-fast）', async () => {
    依存モック.analyzeMorphemes.mockResolvedValue([
      { surface: 'これ', pos: '指示詞' },
      { surface: 'は', pos: '助詞' },
      { surface: 'ペン', pos: '名詞' },
      { surface: 'です', pos: '判定詞' },
    ])

    await expect(judgeWord('これはペンです', 依存モック)).rejects.toThrow(
      '文章の判定には対応していません',
    )
    expect(依存モック.judgeEnglishOrigin).not.toHaveBeenCalled()
    expect(依存モック.lookupEnglishWord).not.toHaveBeenCalled()
  })

  it('形態素が 1 つだけなら助詞相当の品詞でも文章とはみなさない', async () => {
    // 「サボる」のような 1 語の動詞入力を文章として弾かないようにする
    依存モック.analyzeMorphemes.mockResolvedValue([{ surface: 'サボる', pos: '動詞' }])
    依存モック.judgeEnglishOrigin.mockResolvedValue({
      isEnglishOrigin: true,
      englishWord: 'sabotage',
      note: '英語の sabotage が語源です。',
    })
    依存モック.lookupEnglishWord.mockResolvedValue(辞書ヒット結果)
    依存モック.explainWord.mockResolvedValue('解説')
    依存モック.makeExampleSentences.mockResolvedValue(例文リスト)

    const 結果 = await judgeWord('サボる', 依存モック)

    expect(結果.verdict).toBe('english')
  })
})
