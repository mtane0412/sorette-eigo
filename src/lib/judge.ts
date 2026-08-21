/**
 * 判定パイプラインのオーケストレーション。
 *
 * 「英語由来判定（Gemini Nano）→ 辞書チェック（Free Dictionary API）
 * → 解説生成 → 例文生成（いずれも Gemini Nano）」の流れを制御します。
 * 複合語（例: アルミサッシ）は、全体で英語と確定しなかった場合に
 * 構成パーツごとの辞書チェックへフォールバックします。
 *
 * 依存はすべて `JudgeDeps` として注入するため、UI やテストから
 * 実装を差し替えられます。
 */
import type {
  CompoundPartResult,
  DictionaryLookupResult,
  EnglishOriginJudgement,
  EnglishOriginPart,
  ExampleSentence,
  JudgeResult,
} from '../types'

/** 判定パイプラインの進行状況を表すステップ */
export type JudgeStep =
  | 'judging_origin'
  | 'checking_dictionary'
  | 'checking_parts'
  | 'explaining'
  | 'making_examples'

/**
 * 複合語のパーツとして辞書照会する上限数。
 * パーツごとに辞書 API を呼ぶため、判定時間が伸びすぎないよう先頭から一定数に制限します。
 */
export const MAX_COMPOUND_PARTS = 4

/** カタカナ（全角・半角）・英字の 1 文字にマッチするパターン */
const カタカナ英字 = /[゠-ヿｦ-ﾟA-Za-z]/

/** 漢字・ひらがなの 1 文字にマッチするパターン */
const 漢字ひらがな = /[぀-ゟ一-鿿々]/

/** 入力を「カタカナ英字のまとまり」と「それ以外のまとまり」に分割するパターン */
const 語種のまとまり = /[゠-ヿｦ-ﾟA-Za-z]+|[^゠-ヿｦ-ﾟA-Za-z]+/g

/**
 * 入力に漢字・ひらがなとカタカナ・英字が混在するかを返します。
 *
 * 英語の外来語は原則カタカナ（または英字）だけで表記されるため、
 * 語種が混在する入力（例: 窓サッシ、パン工場）が全体でひとつの
 * 英語の外来語であることはあり得ず、構造上は必ず複合語です。
 */
function 語種が混在する(入力: string): boolean {
  return カタカナ英字.test(入力) && 漢字ひらがな.test(入力)
}

/** judgeWord が必要とする依存（Gemini Nano・辞書 API のラッパー） */
export interface JudgeDeps {
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
   * verdict が確定する辞書チェック完了後から、次フェーズの開始前に通知します。
   * 途中で最終結果が確定するケース（not_english / not_in_dictionary）では呼びません。
   */
  onProgress?: (partialResult: JudgeResult) => void
}

/**
 * 日本語の単語が英語かどうかを判定するパイプラインを実行します。
 *
 * 判定の流れ:
 * 1. Gemini Nano で入力の種類（単語 / 複合語 / 文章）と英語由来かどうか・元の英単語を推定
 * 2. 文章はエラーで終了（単語での入力を案内する）
 * 3. 英語由来なら英単語を Free Dictionary API で照会し、実在すれば `english` として解説と例文を生成。
 *    ただし語種が混在する入力（例: 窓サッシ）は全体がひとつの英語の外来語ではあり得ないため照会しない
 * 4. 全体で英語と確定しなかった複合語（モデルの分解、または語種の切り替わりによる機械分割）は、
 *    パーツごとに辞書照会し、実在する英単語が含まれれば `english_compound` で終了
 * 5. それ以外は従来どおり `not_english` / `not_in_dictionary` で終了
 *
 * @param input - ユーザーが入力した日本語の単語
 * @param deps - Gemini Nano・辞書 API への依存
 * @throws {Error} 入力が空文字・空白のみの場合、または文章と判定された場合（fail-fast）
 */
export async function judgeWord(input: string, deps: JudgeDeps): Promise<JudgeResult> {
  const 判定対象 = input.trim()
  if (判定対象 === '') {
    throw new Error('判定する単語を入力してください')
  }

  deps.onStep?.('judging_origin')
  const 由来判定 = await deps.judgeEnglishOrigin(判定対象)

  // 文章は語源判定の対象にできないため、fail-fast で単語での入力を案内する
  if (由来判定.inputType === 'sentence') {
    throw new Error(
      '文章の判定には対応していません。単語をひとつ入力してください（例: アルミサッシ）',
    )
  }

  // 判定に使うパーツ一覧を決める（モデルの分解を優先し、語種が混在する入力は機械分割で補完）
  const パーツ候補 = パーツ候補を決める(判定対象, 由来判定)

  // モデルが複合語の englishWord に一部のパーツだけの英単語を返すことがある
  // （実機で「アルミサッシ」に sash が返ることを確認）。その場合、全体照会で
  // パーツの単語が辞書ヒットして「複合語全体＝その英単語」と誤判定してしまうため、
  // 全体照会をスキップしてパーツ判定に進む
  const 全体の英単語が一部のパーツのみを表す =
    由来判定.englishWord !== null &&
    パーツ候補.some((パーツ) => パーツ.englishWord === 由来判定.englishWord)

  // 入力全体をひとつの英単語（または英語表現）として辞書確認できるかどうか。
  // 語種が混在する入力は全体がひとつの英語の外来語ではあり得ないため対象外とする
  const 全体を照会できる =
    由来判定.isEnglishOrigin &&
    由来判定.englishWord !== null &&
    !全体の英単語が一部のパーツのみを表す &&
    !語種が混在する(判定対象)

  let 全体の辞書結果: DictionaryLookupResult | null = null
  if (全体を照会できる && 由来判定.englishWord !== null) {
    deps.onStep?.('checking_dictionary')
    全体の辞書結果 = await deps.lookupEnglishWord(由来判定.englishWord)

    if (全体の辞書結果.exists) {
      return 解説と例文を付けて返す(判定対象, 由来判定.englishWord, 由来判定.note, 全体の辞書結果, deps)
    }
  }

  // 複合語フォールバック: 全体では英語と確定しなかった場合、
  // パーツごとに辞書確認し、実在する英単語が含まれれば「英単語の組み合わせ」とする
  const パーツ判定 = await パーツごとに辞書確認する(パーツ候補, deps)
  if (パーツ判定 !== null) {
    return {
      input: 判定対象,
      verdict: 'english_compound',
      // 一部のパーツだけを表す英単語は、複合語全体の対応語として表示しない
      englishWord: 全体の英単語が一部のパーツのみを表す ? null : 由来判定.englishWord,
      note: 由来判定.note,
      dictionary: 全体の辞書結果,
      explanation: null,
      examples: [],
      parts: パーツ判定,
    }
  }

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

  return {
    input: 判定対象,
    verdict: 'not_in_dictionary',
    englishWord: 由来判定.englishWord,
    note: 由来判定.note,
    dictionary: 全体の辞書結果,
    explanation: null,
    examples: [],
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

/**
 * 判定に使う複合語のパーツ一覧を決めます。
 *
 * モデルが複合語として 2 パーツ以上に分解できていればそれを優先します。
 * 分解できていなくても、語種が混在する入力（例: 窓サッシ）は構造上必ず複合語
 * なので（実機でモデルが複合語と分類しない揺れを確認）、語種の切り替わりで
 * 機械分割して補完します。
 *
 * @returns 判定に使うパーツ（上限 MAX_COMPOUND_PARTS 個）。複合語でなければ空配列
 */
function パーツ候補を決める(判定対象: string, 由来判定: EnglishOriginJudgement): EnglishOriginPart[] {
  if (由来判定.inputType === 'compound' && 由来判定.parts.length >= 2) {
    return 由来判定.parts.slice(0, MAX_COMPOUND_PARTS)
  }

  if (!語種が混在する(判定対象)) {
    return []
  }

  const 分割 = 判定対象.match(語種のまとまり) ?? []
  if (分割.length < 2) {
    return []
  }

  const カタカナ英字の分割 = 分割.filter((表記) => カタカナ英字.test(表記))
  return 分割.slice(0, MAX_COMPOUND_PARTS).map((表記) => ({
    japanese: 表記,
    // カタカナ英字のまとまりがひとつだけなら、モデルが推定した全体の英単語は
    // そのまとまりに対応するとみなす。複数ある場合はどれに対応するか判別できない
    // ため割り当てない（誤った紐付けをしない）
    englishWord:
      カタカナ英字.test(表記) && カタカナ英字の分割.length === 1 ? 由来判定.englishWord : null,
  }))
}

/**
 * 複合語の構成パーツごとに辞書照会し、複合語判定（english_compound）が
 * 成立するかを確認します。
 *
 * @returns 辞書に実在する英単語のパーツが 1 つ以上あればパーツごとの結果、成立しなければ null
 */
async function パーツごとに辞書確認する(
  対象パーツ: EnglishOriginPart[],
  deps: JudgeDeps,
): Promise<CompoundPartResult[] | null> {
  // 2 パーツ未満は複合語として分解できていないため、従来の判定に任せる
  if (対象パーツ.length < 2) {
    return null
  }

  // 英語に対応するパーツがひとつも無ければ、辞書照会しても成立しない
  if (対象パーツ.every((パーツ) => パーツ.englishWord === null)) {
    return null
  }

  deps.onStep?.('checking_parts')
  // パーツごとの辞書照会は互いに独立しているため並列で行う
  const パーツ結果 = await Promise.all(
    対象パーツ.map(
      async (パーツ): Promise<CompoundPartResult> => ({
        japanese: パーツ.japanese,
        englishWord: パーツ.englishWord,
        dictionary:
          パーツ.englishWord !== null ? await deps.lookupEnglishWord(パーツ.englishWord) : null,
      }),
    ),
  )

  // 辞書に実在する英単語がひとつも含まれなければ複合語判定は成立しない
  const 実在する英単語がある = パーツ結果.some((パーツ) => パーツ.dictionary?.exists === true)
  return 実在する英単語がある ? パーツ結果 : null
}
