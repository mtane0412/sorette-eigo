/**
 * 判定パイプラインのオーケストレーション。
 *
 * 「英語由来判定（Gemini Nano）→ 辞書チェック（Free Dictionary API）
 * → 解説生成 → 例文生成（いずれも Gemini Nano）」の流れを制御します。
 *
 * 依存はすべて `JudgeDeps` として注入するため、UI やテストから
 * 実装を差し替えられます。
 */
import type {
  DictionaryLookupResult,
  EnglishOriginJudgement,
  ExampleSentence,
  JudgeResult,
} from '../types'

/** 判定パイプラインの進行状況を表すステップ */
export type JudgeStep =
  | 'judging_origin'
  | 'checking_dictionary'
  | 'explaining'
  | 'making_examples'

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
 * 1. Gemini Nano で英語由来かどうかと元の英単語を推定
 * 2. 英語由来でなければ `not_english` で終了
 * 3. 英単語を Free Dictionary API で照会し、無ければ `not_in_dictionary` で終了
 * 4. 実在すれば `english` とし、解説と例文を生成
 *
 * @param input - ユーザーが入力した日本語の単語
 * @param deps - Gemini Nano・辞書 API への依存
 * @throws {Error} 入力が空文字・空白のみの場合（fail-fast）
 */
export async function judgeWord(input: string, deps: JudgeDeps): Promise<JudgeResult> {
  const 判定対象 = input.trim()
  if (判定対象 === '') {
    throw new Error('判定する単語を入力してください')
  }

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

  // ここで verdict: english が確定するため、以降は解説・例文ができ次第
  // 途中結果を通知して UI に段階的に反映できるようにする
  const 途中結果: JudgeResult = {
    input: 判定対象,
    verdict: 'english',
    englishWord: 由来判定.englishWord,
    note: 由来判定.note,
    dictionary: 辞書結果,
    explanation: null,
    examples: [],
  }
  deps.onProgress?.(途中結果)

  deps.onStep?.('explaining')
  const 解説 = await deps.explainWord(由来判定.englishWord, 判定対象)
  deps.onProgress?.({ ...途中結果, explanation: 解説 })

  deps.onStep?.('making_examples')
  const 例文 = await deps.makeExampleSentences(由来判定.englishWord)

  return { ...途中結果, explanation: 解説, examples: 例文 }
}
