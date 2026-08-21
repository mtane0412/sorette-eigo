/**
 * Gemini Nano（Chrome 内蔵 AI / Prompt API）のラッパー。
 *
 * このアプリで必要な 3 つの生成タスクを提供します。
 * 1. 日本語の単語が英語由来かどうかの判定（構造化出力）
 * 2. 英単語の日本語での解説
 * 3. 英単語を使った例文の生成（構造化出力）
 *
 * すべての推論はユーザーのブラウザ内（オンデバイス）で実行されます。
 */
import type {
  LanguageModelAvailability,
  LanguageModelPromptOptions,
  LanguageModelSession,
} from './promptApi'
import type { EnglishOriginJudgement, ExampleSentence } from '../types'

/** Gemini Nano の呼び出し・出力解析に失敗したことを表すエラー */
export class GeminiNanoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GeminiNanoError'
  }
}

/**
 * prompt 1 回あたりの制限時間（ミリ秒）。
 *
 * Chrome のオンデバイスモデルはモデルプロセスの状態によって推論が
 * 無限にハングすることがあるため（実機で確認）、fail-fast の方針で
 * 一定時間で打ち切ってエラーを表面化させます。
 */
export const PROMPT_TIMEOUT_MS = 60_000

/**
 * Promise に制限時間を設けます。時間内に完了しなければ GeminiNanoError で失敗します。
 */
async function タイムアウト付きで待つ<T>(
  処理: Promise<T>,
  制限ミリ秒: number,
  説明: string,
): Promise<T> {
  let タイマー: ReturnType<typeof setTimeout> | undefined
  const タイムアウト = new Promise<never>((_, reject) => {
    タイマー = setTimeout(() => {
      reject(
        new GeminiNanoError(
          `${説明}が ${Math.round(制限ミリ秒 / 1000)} 秒以内に完了しませんでした。` +
            'モデルが応答しない場合はページを再読み込みするか、Chrome を再起動してください。',
        ),
      )
    }, 制限ミリ秒)
  })
  try {
    return await Promise.race([処理, タイムアウト])
  } finally {
    clearTimeout(タイマー)
  }
}

/**
 * このブラウザが Prompt API（Gemini Nano）に対応しているかを返します。
 */
export function isPromptApiSupported(): boolean {
  return typeof globalThis.LanguageModel !== 'undefined'
}

/**
 * Gemini Nano の可用性を確認します。
 *
 * @returns Prompt API 非対応ブラウザの場合は `unavailable`
 */
export async function checkAvailability(): Promise<LanguageModelAvailability> {
  if (!isPromptApiSupported()) {
    return 'unavailable'
  }
  return globalThis.LanguageModel!.availability()
}

/**
 * 語源の分類。
 *
 * yes/no の boolean で聞くと小型モデルは true に偏りやすいため
 * （実機で「もちもち」が英語由来と誤判定されることを確認）、
 * 選択肢から選ばせる enum 形式にして精度を上げています。
 */
const 語源分類 = ['english', 'wasei_eigo', 'japanese', 'other_language'] as const

type 語源 = (typeof 語源分類)[number]

/** 入力の種類の分類（単語 / 複合語 / 文章） */
const 入力タイプ分類 = ['single_word', 'compound', 'sentence'] as const

type 入力タイプ = (typeof 入力タイプ分類)[number]

/** 英語由来判定の構造化出力を制約する JSON Schema */
const 英語由来判定スキーマ = {
  type: 'object',
  properties: {
    inputType: { type: 'string', enum: 入力タイプ分類 },
    origin: { type: 'string', enum: 語源分類 },
    englishWord: { type: 'string' },
    parts: {
      type: 'array',
      items: { type: 'string' },
      // モデルの無限出力を防ぐための上限。判定パイプライン側では
      // さらに judge.ts の MAX_COMPOUND_PARTS 個までに絞って判定する
      maxItems: 6,
    },
    note: { type: 'string' },
  },
  required: ['inputType', 'origin', 'englishWord', 'parts', 'note'],
  additionalProperties: false,
} as const

/** 例文生成の構造化出力を制約する JSON Schema */
const 例文生成スキーマ = {
  type: 'object',
  properties: {
    examples: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          english: { type: 'string' },
          japanese: { type: 'string' },
        },
        required: ['english', 'japanese'],
        additionalProperties: false,
      },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ['examples'],
  additionalProperties: false,
} as const

/**
 * モデルの出力文字列を JSON としてパースします。
 *
 * @throws {GeminiNanoError} パースに失敗した場合（fail-fast: 不正な出力を握りつぶさない）
 */
function モデル出力をJSONパースする(出力: string): unknown {
  try {
    return JSON.parse(出力)
  } catch (cause) {
    throw new GeminiNanoError(
      `Gemini Nano の出力を JSON として解釈できませんでした: ${出力.slice(0, 100)}`,
      { cause },
    )
  }
}

/** 語源判定の構造化出力（検証済み）の形 */
interface 語源判定出力 {
  inputType: 入力タイプ
  origin: 語源
  englishWord: string
  parts: string[]
  note: string
}

/**
 * 語源判定の出力が期待した形かをランタイムで検証します。
 *
 * @throws {GeminiNanoError} フィールドが欠けている・型が違う・分類が未知の場合
 */
function 語源判定として検証する(値: unknown): 語源判定出力 {
  const レコード = typeof 値 === 'object' && 値 !== null ? (値 as Record<string, unknown>) : null
  if (
    レコード !== null &&
    (入力タイプ分類 as readonly string[]).includes(レコード.inputType as string) &&
    (語源分類 as readonly string[]).includes(レコード.origin as string) &&
    typeof レコード.englishWord === 'string' &&
    Array.isArray(レコード.parts) &&
    レコード.parts.every((パーツ) => typeof パーツ === 'string') &&
    typeof レコード.note === 'string'
  ) {
    return 値 as unknown as 語源判定出力
  }
  throw new GeminiNanoError(
    `Gemini Nano の語源判定が期待した形式ではありませんでした: ${JSON.stringify(値).slice(0, 100)}`,
  )
}

/**
 * モデルが返した英単語の綴りを小文字・前後空白なしに正規化します。
 * 空文字（英語由来でない）は null に変換します。
 */
function 英単語を正規化する(englishWord: string): string | null {
  const 正規化済み = englishWord.trim().toLowerCase()
  return 正規化済み === '' ? null : 正規化済み
}

/**
 * 例文生成の出力が期待した形かをランタイムで検証します。
 *
 * @throws {GeminiNanoError} examples が配列でない・要素の形が不正な場合
 */
function 例文リストとして検証する(値: unknown): ExampleSentence[] {
  const examples =
    typeof 値 === 'object' && 値 !== null
      ? (値 as Record<string, unknown>).examples
      : undefined
  if (
    Array.isArray(examples) &&
    examples.every(
      (例文) =>
        typeof 例文 === 'object' &&
        例文 !== null &&
        typeof (例文 as Record<string, unknown>).english === 'string' &&
        typeof (例文 as Record<string, unknown>).japanese === 'string',
    )
  ) {
    return examples as ExampleSentence[]
  }
  throw new GeminiNanoError(
    `Gemini Nano の例文が期待した形式ではありませんでした: ${JSON.stringify(値).slice(0, 100)}`,
  )
}

/**
 * Prompt API のセッションを生成します。
 *
 * 注意: initialPrompts（システムプロンプト）は使いません。
 * initialPrompts 付きの create はモデル推論を伴い、モデルプロセスの
 * 状態によって無限にハングすることを実機で確認したため、
 * 指示は各プロンプト内に自己完結で記述する方針としています。
 *
 * @param onProgress - モデルダウンロードの進捗（0〜1）を受け取るコールバック
 */
async function 内部セッションを生成する(
  onProgress?: (loaded: number) => void,
): Promise<LanguageModelSession> {
  return globalThis.LanguageModel!.create({
    expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }],
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        onProgress?.((event as Event & { loaded: number }).loaded)
      })
    },
  })
}

/**
 * Gemini Nano とのセッション。
 *
 * `createNanoSession()` で生成し、使い終わったら `destroy()` を呼んでください。
 */
export class NanoSession {
  #session: LanguageModelSession

  constructor(session: LanguageModelSession) {
    this.#session = session
  }

  /** 制限時間と中断シグナルを付けて、現在のセッションで prompt を 1 回実行します。 */
  async #promptOnce(input: string, options?: LanguageModelPromptOptions): Promise<string> {
    return タイムアウト付きで待つ(
      this.#session.prompt(input, {
        ...options,
        signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS),
      }),
      PROMPT_TIMEOUT_MS,
      'Gemini Nano の応答生成',
    )
  }

  /**
   * 制限時間付きで prompt を実行します。
   *
   * Chrome のオンデバイスモデルは推論後にモデルプロセスがクラッシュし、
   * 次の呼び出しが UnknownError（kErrorUnknown）になることがあるため
   * （実機で確認）、失敗時は新しいセッションに作り直して同じプロンプトを
   * 1 回だけ再試行します。
   *
   * @throws {GeminiNanoError} 再試行しても失敗した場合
   */
  async #prompt(input: string, options?: LanguageModelPromptOptions): Promise<string> {
    try {
      return await this.#promptOnce(input, options)
    } catch (初回の失敗) {
      try {
        // クラッシュしたセッションの破棄自体が失敗しても、再作成には影響しないため無視する
        this.#session.destroy()
      } catch {
        /* 破棄の失敗は無視 */
      }
      try {
        this.#session = await 内部セッションを生成する()
        return await this.#promptOnce(input, options)
      } catch (再試行の失敗) {
        throw new GeminiNanoError(
          'Gemini Nano の呼び出しに失敗しました（セッションを作り直しても失敗）。' +
            `初回: ${初回の失敗 instanceof Error ? 初回の失敗.message : String(初回の失敗)}`,
          { cause: 再試行の失敗 },
        )
      }
    }
  }

  /**
   * 日本語の単語が英語由来（カタカナ英語・和製英語含む）かどうかを判定します。
   *
   * あわせて入力の種類（単語 / 複合語 / 文章）を分類し、
   * 複合語の場合は構成パーツの日本語表記も返します。
   * パーツごとの英単語はここでは推定しません（パーツ単体を改めてこのメソッドにかけます）。
   *
   * @param word - 判定対象の日本語の単語
   * @throws {GeminiNanoError} モデルの出力が不正な場合
   */
  async judgeEnglishOrigin(word: string): Promise<EnglishOriginJudgement> {
    const プロンプト = [
      `日本語の入力「${word}」を分析してください。`,
      '',
      'まず inputType で入力の種類を分類してください:',
      '- single_word: 1つの単語（例: コントロール、もちもち）',
      '- compound: 複数の単語がつながった複合語（例: アルミサッシ、窓ガラス）',
      '- sentence: 助詞や述語を含む文章（例: これはペンです）',
      '',
      '次に origin で語源を分類してください:',
      '- english: 英語の単語が日本語に外来語として入ったもの（例: コントロール、テレビ）',
      '- wasei_eigo: 英単語を組み合わせた和製英語（例: サラリーマン、コンセント）',
      '- japanese: 日本語固有の言葉。擬音語・擬態語（もちもち・ふわふわ等）や、日本語から英語へ輸出された言葉（寿司・もち・カラオケ等）もこれ',
      '- other_language: 英語以外の外国語由来（例: パン、カルテ）',
      '',
      '注意: 日本語への直接の借用元が英語なら english としてください。',
      'その英単語のさらなる語源がフランス語・ラテン語などでも english です（例: サッシ → 英語 sash）。',
      'アルミ（aluminium）やスマホ（smartphone）のように省略された外来語も english とし、englishWord には省略前の完全な英単語を入れてください。',
      '',
      'english / wasei_eigo の場合は元の英単語の綴りを englishWord に入れ、それ以外は空文字にしてください。',
      'inputType が compound の場合、englishWord には複合語全体に対応する英語表現を入れてください（例: アルミサッシ → aluminum sash）。一部のパーツだけの英単語を入れてはいけません。',
      '',
      'inputType が compound の場合は、parts に構成パーツの日本語表記を先頭から順に入れてください（例: アルミサッシ → ["アルミ", "サッシ"]）。',
      'compound でない場合、parts は空配列にしてください。',
      '',
      'note には語源の短い補足を日本語で書いてください。',
    ].join('\n')

    const 出力 = await this.#prompt(プロンプト, {
      responseConstraint: 英語由来判定スキーマ,
    })
    const 判定 = 語源判定として検証する(モデル出力をJSONパースする(出力))

    // 英語の外来語・和製英語のどちらも「英語由来」として扱う
    const 英語由来 = 判定.origin === 'english' || 判定.origin === 'wasei_eigo'
    // パーツは複合語のときだけ意味を持つ（single_word で parts を返すモデルの揺れを吸収する）
    const パーツ一覧 =
      判定.inputType === 'compound'
        ? 判定.parts
            .map((パーツ) => パーツ.trim())
            // モデルが空のパーツを返した場合は判定できないため除外する
            .filter((パーツ) => パーツ !== '')
        : []
    return {
      inputType: 判定.inputType,
      isEnglishOrigin: 英語由来,
      englishWord: 英語由来 ? 英単語を正規化する(判定.englishWord) : null,
      parts: パーツ一覧,
      note: 判定.note,
    }
  }

  /**
   * 英単語を日本語で解説します。
   *
   * @param englishWord - 解説する英単語
   * @param originalInput - ユーザーが入力した元の日本語（文脈として渡す）
   */
  async explainWord(englishWord: string, originalInput: string): Promise<string> {
    const プロンプト = [
      `英単語「${englishWord}」について、日本語で3〜4文で簡潔に解説してください。`,
      '意味・品詞・よく使われる場面を含めてください。',
      `この単語は日本語の「${originalInput}」の語源にあたります。`,
    ].join('\n')

    const 出力 = await this.#prompt(プロンプト)
    return 出力.trim()
  }

  /**
   * 英単語を使った例文（日本語訳付き）を 3 つ生成します。
   *
   * @param englishWord - 例文に使う英単語
   * @throws {GeminiNanoError} 例文が 1 つも得られなかった場合
   */
  async makeExampleSentences(englishWord: string): Promise<ExampleSentence[]> {
    const プロンプト = [
      `英単語「${englishWord}」を使った、シンプルで実用的な英語の例文を3つ作ってください。`,
      'それぞれの例文に自然な日本語訳を付けてください。',
    ].join('\n')

    const 出力 = await this.#prompt(プロンプト, {
      responseConstraint: 例文生成スキーマ,
    })
    const 例文リスト = 例文リストとして検証する(モデル出力をJSONパースする(出力))

    if (例文リスト.length === 0) {
      throw new GeminiNanoError('Gemini Nano が例文を生成できませんでした')
    }
    return 例文リスト
  }

  /** セッションを破棄してリソースを解放します。 */
  destroy(): void {
    this.#session.destroy()
  }
}

/**
 * Gemini Nano のセッションを作成します。
 *
 * モデルが未ダウンロードの場合はダウンロードが開始され、
 * 進捗（0〜1）が `onProgress` に通知されます。
 *
 * @param onProgress - ダウンロード進捗（0〜1）を受け取るコールバック
 * @throws {GeminiNanoError} Prompt API 非対応ブラウザ、またはセッション作成に失敗した場合
 */
export async function createNanoSession(
  onProgress?: (loaded: number) => void,
): Promise<NanoSession> {
  if (!isPromptApiSupported()) {
    throw new GeminiNanoError(
      'このブラウザは Prompt API（Gemini Nano）に対応していません',
    )
  }

  try {
    const session = await 内部セッションを生成する(onProgress)
    return new NanoSession(session)
  } catch (cause) {
    if (cause instanceof GeminiNanoError) {
      throw cause
    }
    throw new GeminiNanoError('Gemini Nano のセッション作成に失敗しました', { cause })
  }
}
