/**
 * アプリ全体で共有する型定義。
 *
 * 「それって英語？」は、日本語の単語が英語由来かどうかを
 * Gemini Nano（Chrome 内蔵 AI）と Free Dictionary API で判定するサービスです。
 * このファイルには判定結果・履歴などのドメイン型を定義します。
 */

/**
 * 判定結果の種別。
 *
 * - `english`: 英語由来で、辞書にも実在する英単語が確認できた
 * - `english_compound`: 全体はひとつの英単語ではないが、分解したパーツに辞書に実在する英単語が含まれる（例: アルミサッシ）
 * - `not_english`: 英語由来ではない（日本語固有・他言語由来など）
 * - `not_in_dictionary`: 英語由来と推定されたが、対応する英単語が辞書に存在しない（和製英語の可能性）
 */
export type Verdict = 'english' | 'english_compound' | 'not_english' | 'not_in_dictionary'

/**
 * 入力の種類。
 *
 * - `single_word`: 1 つの単語（例: コントロール）
 * - `compound`: 複数の単語がつながった複合語（例: アルミサッシ）
 * - `sentence`: 助詞や述語を含む文章（判定は未対応）
 */
export type InputType = 'single_word' | 'compound' | 'sentence'

/**
 * Gemini Nano が生成する英語の例文（日本語訳付き）。
 */
export interface ExampleSentence {
  /** 英語の例文 */
  english: string
  /** 例文の日本語訳 */
  japanese: string
}

/**
 * 照会に使用した辞書の種別。
 *
 * - `dictionaryapi`: メイン辞書（Free Dictionary API）
 * - `datamuse`: 予備辞書（Datamuse API）。メイン辞書が失敗したときのフォールバック先
 */
export type DictionarySource = 'dictionaryapi' | 'datamuse'

/**
 * 英単語の辞書照会結果。
 */
export interface DictionaryLookupResult {
  /** 辞書に単語が存在するかどうか */
  exists: boolean
  /** 発音記号（例: /kənˈtɹəʊl/）。存在しない場合は null */
  phonetic: string | null
  /** 品詞ごとの代表的な定義（英語） */
  meanings: {
    /** 品詞（例: noun, verb） */
    partOfSpeech: string
    /** 定義文（英語） */
    definition: string
  }[]
  /**
   * 照会に使用した辞書。
   * フォールバック導入前に保存された履歴データには存在しないため optional にしています。
   */
  source?: DictionarySource
}

/**
 * 複合語を構成するパーツ（Gemini Nano による分解結果）。
 */
export interface EnglishOriginPart {
  /** パーツの日本語表記（例: アルミ） */
  japanese: string
  /** 対応する英単語の綴り（例: aluminium）。英語由来でない場合は null */
  englishWord: string | null
}

/**
 * Gemini Nano による「英語由来かどうか」の判定結果。
 */
export interface EnglishOriginJudgement {
  /** 入力の種類（単語 / 複合語 / 文章） */
  inputType: InputType
  /** 英語由来（和製英語含む）と判定されたかどうか */
  isEnglishOrigin: boolean
  /** 元になった英単語の綴り。英語由来でない場合は null */
  englishWord: string | null
  /** 複合語の構成パーツ。複合語でない場合は空配列 */
  parts: EnglishOriginPart[]
  /** 語源についての短い日本語の補足 */
  note: string
}

/**
 * 複合語のパーツごとの判定結果（辞書照会済み）。
 */
export interface CompoundPartResult {
  /** パーツの日本語表記（例: アルミ） */
  japanese: string
  /** 対応する英単語の綴り。英語由来でない場合は null */
  englishWord: string | null
  /** 辞書の照会結果。英語由来でない（照会しなかった）場合は null */
  dictionary: DictionaryLookupResult | null
}

/**
 * 判定パイプライン全体の結果。
 */
export interface JudgeResult {
  /** ユーザーが入力した日本語の単語 */
  input: string
  /** 判定結果の種別 */
  verdict: Verdict
  /** 対応する英単語。英語由来でない場合は null */
  englishWord: string | null
  /** Gemini Nano による語源の補足（日本語） */
  note: string
  /** 辞書の照会結果。辞書照会まで到達しなかった場合は null */
  dictionary: DictionaryLookupResult | null
  /** Gemini Nano による英単語の解説（日本語）。生成しなかった場合は null */
  explanation: string | null
  /** Gemini Nano による例文。生成しなかった場合は空配列 */
  examples: ExampleSentence[]
  /**
   * 複合語のパーツごとの判定結果。verdict が `english_compound` の場合のみ設定します。
   * この機能の導入前に保存された履歴データには存在しないため optional にしています。
   */
  parts?: CompoundPartResult[]
}

/**
 * クライアント側（localStorage）に保存する履歴エントリ。
 */
export interface HistoryEntry extends JudgeResult {
  /** 一意な ID（UUID） */
  id: string
  /** 判定日時（エポックミリ秒） */
  judgedAt: number
}
