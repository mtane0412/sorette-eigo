/**
 * 判定パイプラインのオーケストレーション。
 *
 * 「形態素分解（Yahoo!テキスト解析）→ 語源判定（Gemini Nano）
 * → 辞書チェック（Free Dictionary API）→ 解説生成 → 例文生成（いずれも Gemini Nano）」
 * の流れを制御します。複合語（例: アルミサッシ）は日本語の段階でパーツに分解し、
 * パーツごとに語源判定と辞書チェックを行います。
 *
 * 依存はすべて `JudgeDeps` として注入するため、UI やテストから
 * 実装を差し替えられます。
 */
import type {
  CompoundPartResult,
  DictionaryLookupResult,
  EnglishOriginJudgement,
  ExampleSentence,
  JudgeResult,
} from '../types'
import type { MorphToken } from './morphology'

/** 判定パイプラインの進行状況を表すステップ */
export type JudgeStep =
  | 'analyzing_morphemes'
  | 'judging_origin'
  | 'checking_dictionary'
  | 'checking_parts'
  | 'explaining'
  | 'making_examples'

/**
 * 複合語のパーツとして判定する上限数。
 * パーツごとにオンデバイス推論と辞書照会を行うため、判定時間が伸びすぎないよう
 * 先頭から一定数に制限します。
 */
export const MAX_COMPOUND_PARTS = 4

/** カタカナ（全角・半角）・英字の 1 文字にマッチするパターン */
const カタカナ英字 = /[゠-ヿｦ-ﾟA-Za-z]/

/** 文章とみなす品詞。これらを含む複数形態素の入力は単語ではなく文章として扱います。 */
const 文章を構成する品詞 = ['助詞', '助動詞', '判定詞']

/** judgeWord が必要とする依存（形態素解析・Gemini Nano・辞書 API のラッパー） */
export interface JudgeDeps {
  /** 日本語のテキストを形態素に分解する */
  analyzeMorphemes(text: string): Promise<MorphToken[]>
  /** 日本語の単語が英語由来かどうかを判定する */
  judgeEnglishOrigin(word: string): Promise<EnglishOriginJudgement>
  /** 英単語を辞書で照会する */
  lookupEnglishWord(word: string): Promise<DictionaryLookupResult>
  /** 英単語を日本語で解説する */
  explainWord(englishWord: string, originalInput: string): Promise<string>
  /** 英単語を使った例文を生成する */
  makeExampleSentences(englishWord: string): Promise<ExampleSentence[]>
  /** 進行状況の通知先（UI のプログレス表示用） */
  onStep?: (step: JudgeStep) => void
  /**
   * フェーズ完了ごとの途中結果の通知先（UI の段階表示用）。
   * verdict が確定してから、フェーズ（english の解説・例文、english_compound のパーツ）が
   * 完了するたびに通知します。最終結果は通知せず戻り値で返します。
   * 途中で最終結果が確定するケース（not_english / not_in_dictionary）では呼びません。
   */
  onProgress?: (partialResult: JudgeResult) => void
}

/**
 * 日本語の単語が英語かどうかを判定するパイプラインを実行します。
 *
 * 判定の流れ:
 * 1. 形態素解析で入力を分解し、助詞・判定詞などを含む文章はエラーで終了（単語での入力を案内）
 * 2. 形態素が 1 つなら単語として「語源判定 → 辞書照会」を行い、実在すれば `english`（解説・例文つき）
 * 3. 形態素が 2 つ以上なら複合語として、パーツごとに語源判定と辞書照会を行う。
 *    すべてのパーツが英語由来なら、パーツの英単語を結合した全体表現（例: ice cream）を
 *    辞書確認して `english` へ昇格し、そうでなければ実在する英単語を含むとき `english_compound`
 * 4. それ以外は `not_english` / `not_in_dictionary` で終了
 *
 * @param input - ユーザーが入力した日本語の単語
 * @param deps - 形態素解析・Gemini Nano・辞書 API への依存
 * @throws {Error} 入力が空文字・空白のみの場合、または文章と判定された場合（fail-fast）
 */
export async function judgeWord(input: string, deps: JudgeDeps): Promise<JudgeResult> {
  const 判定対象 = input.trim()
  if (判定対象 === '') {
    throw new Error('判定する単語を入力してください')
  }

  deps.onStep?.('analyzing_morphemes')
  const 形態素 = await deps.analyzeMorphemes(判定対象)

  // 助詞・助動詞・判定詞を含む複数形態素の入力は文章とみなし、
  // fail-fast で単語での入力を案内する（1 形態素の動詞などは単語として扱う）
  if (
    形態素.length >= 2 &&
    形態素.some((トークン) => 文章を構成する品詞.includes(トークン.pos))
  ) {
    throw new Error(
      '文章の判定には対応していません。単語をひとつ入力してください（例: フィッシャーマン）',
    )
  }

  if (形態素.length >= 2) {
    return 複合語を判定する(
      判定対象,
      形態素.map((トークン) => トークン.surface),
      deps,
    )
  }

  return 単語を判定する(判定対象, deps)
}

/**
 * 単語（形態素 1 つの入力）を「語源判定 → 辞書照会」で判定します。
 */
async function 単語を判定する(判定対象: string, deps: JudgeDeps): Promise<JudgeResult> {
  deps.onStep?.('judging_origin')
  const 由来判定 = await deps.judgeEnglishOrigin(判定対象)

  // 英語由来でない、または由来判定が矛盾している（由来ありなのに英単語なし）場合は
  // 辞書確認ができないため「英語ではない」と扱う
  if (!由来判定.isEnglishOrigin || 由来判定.englishWord === null) {
    return {
      input: 判定対象,
      verdict: 'not_english',
      englishWord: null,
      note: 由来判定.note,
      dictionary: null,
      explanation: null,
      examples: [],
    }
  }

  deps.onStep?.('checking_dictionary')
  const 辞書結果 = await deps.lookupEnglishWord(由来判定.englishWord)

  if (!辞書結果.exists) {
    return {
      input: 判定対象,
      verdict: 'not_in_dictionary',
      englishWord: 由来判定.englishWord,
      note: 由来判定.note,
      dictionary: 辞書結果,
      explanation: null,
      examples: [],
    }
  }

  return 解説と例文を付けて返す(判定対象, 由来判定.englishWord, 由来判定.note, 辞書結果, deps)
}

/**
 * 複合語（形態素 2 つ以上の入力）をパーツごとに判定します。
 *
 * 各パーツを個別に語源判定と辞書照会にかけ、実在する英単語が含まれれば
 * english_compound とします。すべてのパーツが英語由来だった場合のみ、
 * パーツの英単語を結合した全体表現（例: アイス + クリーム → ice cream）が
 * ひとつの英語表現として実在するかを確認し、実在すれば english へ昇格します。
 * パン（ポルトガル語由来）のような英語でないパーツを含む複合語が、
 * 英語フレーズ全体（bread knife）の借用であることはあり得ないためです。
 */
async function 複合語を判定する(
  判定対象: string,
  パーツ分解: string[],
  deps: JudgeDeps,
): Promise<JudgeResult> {
  const 対象パーツ = パーツ分解.slice(0, MAX_COMPOUND_PARTS)

  /** english_compound 確定時の途中結果の雛形（parts を差し替えて通知に使う） */
  const 複合語の途中結果: JudgeResult = {
    input: 判定対象,
    verdict: 'english_compound',
    englishWord: null,
    note: '',
    dictionary: null,
    explanation: null,
    examples: [],
    parts: [],
  }

  const 完了パーツ: CompoundPartResult[] = []
  let 実在する英単語がある = false
  let 全パーツが英語由来 = true

  // 英語の外来語は原則カタカナ・英字表記のため、カタカナ・英字を含むパーツが
  // ひとつも無ければ英語は含まれ得ず、パーツ判定は不要
  if (対象パーツ.some((表記) => カタカナ英字.test(表記))) {
    deps.onStep?.('checking_parts')
    // オンデバイス推論は並列実行できないため、パーツは直列で判定する
    for (const [番号, 表記] of 対象パーツ.entries()) {
      const パーツ結果 = await 単一パーツを判定する(表記, deps)
      完了パーツ.push(パーツ結果)
      if (パーツ結果.dictionary?.exists === true) {
        実在する英単語がある = true
      }
      if (パーツ結果.englishWord === null) {
        全パーツが英語由来 = false
      }
      // english_compound で確定し（全体表現での english 昇格があり得ず）、続きのパーツが
      // ある場合は、完了分だけの途中結果を通知して UI に段階反映する
      if (実在する英単語がある && !全パーツが英語由来 && 番号 < 対象パーツ.length - 1) {
        deps.onProgress?.({ ...複合語の途中結果, parts: [...完了パーツ] })
      }
    }
  } else {
    全パーツが英語由来 = false
  }

  // すべてのパーツが英語由来なら、パーツの英単語を結合した全体表現（例: ice cream）が
  // ひとつの英語表現として実在する可能性があるため、辞書確認して english への昇格を試みる
  let 全体の辞書結果: DictionaryLookupResult | null = null
  let 全体の英語表現: string | null = null
  if (全パーツが英語由来 && 完了パーツ.length > 0) {
    全体の英語表現 = 完了パーツ.map((パーツ) => パーツ.englishWord).join(' ')
    deps.onStep?.('checking_dictionary')
    全体の辞書結果 = await deps.lookupEnglishWord(全体の英語表現)
    if (全体の辞書結果.exists) {
      return 解説と例文を付けて返す(判定対象, 全体の英語表現, '', 全体の辞書結果, deps)
    }
  }

  if (実在する英単語がある) {
    return {
      ...複合語の途中結果,
      // 全パーツが英語由来のときだけ、結合した全体表現を複合語の対応語として表示する
      // （一部のパーツだけの英単語を複合語全体の対応語として見せない）
      englishWord: 全体の英語表現,
      dictionary: 全体の辞書結果,
      parts: 完了パーツ,
    }
  }

  // 英語由来のパーツはあるが、どれも辞書で実在確認できなかった場合
  const 英語由来のパーツの英単語 = 完了パーツ
    .map((パーツ) => パーツ.englishWord)
    .filter((英単語): 英単語 is string => 英単語 !== null)
  if (英語由来のパーツの英単語.length > 0) {
    return {
      input: 判定対象,
      verdict: 'not_in_dictionary',
      englishWord: 英語由来のパーツの英単語.join(' '),
      note: '',
      dictionary: 全体の辞書結果,
      explanation: null,
      examples: [],
    }
  }

  return {
    input: 判定対象,
    verdict: 'not_english',
    englishWord: null,
    note: '',
    dictionary: null,
    explanation: null,
    examples: [],
  }
}

/**
 * 複合語のパーツ 1 つを語源判定と辞書照会にかけます。
 */
async function 単一パーツを判定する(表記: string, deps: JudgeDeps): Promise<CompoundPartResult> {
  // 英語の外来語は原則カタカナ・英字表記のため、漢字・ひらがなのみのパーツは
  // 英語由来ではないと確定でき、推論を省略する
  if (!カタカナ英字.test(表記)) {
    return { japanese: 表記, englishWord: null, dictionary: null }
  }

  const 判定 = await deps.judgeEnglishOrigin(表記)
  if (!判定.isEnglishOrigin || 判定.englishWord === null) {
    return { japanese: 表記, englishWord: null, dictionary: null }
  }
  return {
    japanese: 表記,
    englishWord: 判定.englishWord,
    dictionary: await deps.lookupEnglishWord(判定.englishWord),
  }
}

/**
 * verdict: english が確定した後の解説・例文生成フェーズを実行します。
 * フェーズが完了するたびに `onProgress` へ途中結果を通知し、UI に段階的に反映できるようにします。
 */
async function 解説と例文を付けて返す(
  判定対象: string,
  英単語: string,
  note: string,
  辞書結果: DictionaryLookupResult,
  deps: JudgeDeps,
): Promise<JudgeResult> {
  const 途中結果: JudgeResult = {
    input: 判定対象,
    verdict: 'english',
    englishWord: 英単語,
    note,
    dictionary: 辞書結果,
    explanation: null,
    examples: [],
  }
  deps.onProgress?.(途中結果)

  deps.onStep?.('explaining')
  const 解説 = await deps.explainWord(英単語, 判定対象)
  deps.onProgress?.({ ...途中結果, explanation: 解説 })

  deps.onStep?.('making_examples')
  const 例文 = await deps.makeExampleSentences(英単語)

  return { ...途中結果, explanation: 解説, examples: 例文 }
}
