/**
 * geminiNano.ts（Chrome 内蔵 AI / Prompt API ラッパー）のテスト。
 *
 * 実際の Gemini Nano は呼び出せないため、グローバルの LanguageModel を
 * モックして、可用性チェック・セッション生成・各プロンプトの
 * リクエスト組み立てとレスポンス解析を検証します。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GeminiNanoError,
  PROMPT_TIMEOUT_MS,
  checkAvailability,
  createNanoSession,
  isPromptApiSupported,
} from './geminiNano'

/** LanguageModel.create が返すセッションのモック */
const promptモック = vi.fn()
const destroyモック = vi.fn()
const セッションモック = { prompt: promptモック, destroy: destroyモック }

/** グローバル LanguageModel のモック */
const availabilityモック = vi.fn()
const createモック = vi.fn()

beforeEach(() => {
  vi.stubGlobal('LanguageModel', {
    availability: availabilityモック,
    create: createモック,
  })
  createモック.mockResolvedValue(セッションモック)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('isPromptApiSupported', () => {
  it('LanguageModel が存在すれば true を返す', () => {
    expect(isPromptApiSupported()).toBe(true)
  })

  it('LanguageModel が存在しなければ false を返す', () => {
    vi.stubGlobal('LanguageModel', undefined)
    expect(isPromptApiSupported()).toBe(false)
  })
})

describe('checkAvailability', () => {
  it('LanguageModel.availability の結果をそのまま返す', async () => {
    availabilityモック.mockResolvedValue('downloadable')
    await expect(checkAvailability()).resolves.toBe('downloadable')
  })

  it('Prompt API 非対応ブラウザでは unavailable を返す', async () => {
    vi.stubGlobal('LanguageModel', undefined)
    await expect(checkAvailability()).resolves.toBe('unavailable')
  })
})

describe('createNanoSession', () => {
  it('initialPrompts を渡さずにセッションを作成する（create のハング回避）', async () => {
    // Chrome の実装では initialPrompts 付き create がモデル推論を伴い、
    // モデルプロセスの状態によって無限にハングすることを実機で確認したため、
    // システムプロンプトは使わず各プロンプトを自己完結にする方針とする
    await createNanoSession()

    const 渡されたオプション = createモック.mock.calls[0][0]
    expect(渡されたオプション).not.toHaveProperty('initialPrompts')
  })

  it('ダウンロード進捗イベントを onProgress に通知する', async () => {
    // monitor コールバックに渡された EventTarget へ downloadprogress を発火させる
    let 監視ターゲット: EventTarget | undefined
    createモック.mockImplementation(
      async (options: { monitor?: (m: EventTarget) => void }) => {
        監視ターゲット = new EventTarget()
        options.monitor?.(監視ターゲット)
        return セッションモック
      },
    )
    const 進捗リスナー = vi.fn()

    await createNanoSession(進捗リスナー)

    const イベント = new Event('downloadprogress') as Event & { loaded: number }
    イベント.loaded = 0.5
    監視ターゲット!.dispatchEvent(イベント)

    expect(進捗リスナー).toHaveBeenCalledWith(0.5)
  })

  it('Prompt API 非対応ブラウザでは GeminiNanoError を投げる', async () => {
    vi.stubGlobal('LanguageModel', undefined)
    await expect(createNanoSession()).rejects.toThrow(GeminiNanoError)
  })
})

describe('NanoSession.judgeEnglishOrigin', () => {
  it('英語由来の単語は isEnglishOrigin: true と英単語を返す', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'single_word',
        origin: 'english',
        englishWord: 'control',
        parts: [],
        note: '英語の control が語源のカタカナ語です。',
      }),
    )
    const セッション = await createNanoSession()

    const 結果 = await セッション.judgeEnglishOrigin('コントロール')

    expect(結果).toEqual({
      inputType: 'single_word',
      isEnglishOrigin: true,
      englishWord: 'control',
      parts: [],
      note: '英語の control が語源のカタカナ語です。',
    })
    // プロンプトに対象の単語が含まれていること
    expect(promptモック.mock.calls[0][0]).toContain('コントロール')
  })

  it('プロンプトに複合語の englishWord は全体に対応する英語表現とする指示を含める', async () => {
    // 実機でモデルが「アルミサッシ」の englishWord に一部のパーツだけの sash を
    // 返したことを確認したため、全体の英語表現（aluminum sash）を求める指示を明記する
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'compound',
        origin: 'wasei_eigo',
        englishWord: 'aluminum sash',
        parts: [
          { japanese: 'アルミ', englishWord: 'aluminium' },
          { japanese: 'サッシ', englishWord: 'sash' },
        ],
        note: '',
      }),
    )
    const セッション = await createNanoSession()

    await セッション.judgeEnglishOrigin('アルミサッシ')

    expect(promptモック.mock.calls[0][0]).toContain('複合語全体に対応する英語表現')
  })

  it('語源分類のプロンプトに「直接の借用元が英語なら english」の基準を含める', async () => {
    // サッシ（英語 sash 経由。sash 自体はフランス語 châssis 起源）のような単語が
    // 「さらに遡れば他言語」という理由で other_language に誤分類されるのを防ぐための基準
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'single_word',
        origin: 'english',
        englishWord: 'sash',
        parts: [],
        note: '英語の sash が語源です。',
      }),
    )
    const セッション = await createNanoSession()

    await セッション.judgeEnglishOrigin('サッシ')

    expect(promptモック.mock.calls[0][0]).toContain('直接の借用元が英語')
  })

  it('英語由来でない場合は englishWord を null に正規化する', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'single_word',
        origin: 'japanese',
        englishWord: '',
        parts: [],
        note: '日本語固有の言葉です。',
      }),
    )
    const セッション = await createNanoSession()

    const 結果 = await セッション.judgeEnglishOrigin('もちもち')

    expect(結果.isEnglishOrigin).toBe(false)
    expect(結果.englishWord).toBeNull()
  })

  it('和製英語（wasei_eigo）も英語由来として扱う', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'single_word',
        origin: 'wasei_eigo',
        englishWord: 'salaryman',
        parts: [],
        note: '英単語を組み合わせた和製英語です。',
      }),
    )
    const セッション = await createNanoSession()

    const 結果 = await セッション.judgeEnglishOrigin('サラリーマン')

    expect(結果.isEnglishOrigin).toBe(true)
    expect(結果.englishWord).toBe('salaryman')
  })

  it('英単語は小文字・前後空白なしに正規化する', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'single_word',
        origin: 'english',
        englishWord: ' Control ',
        parts: [],
        note: '',
      }),
    )
    const セッション = await createNanoSession()

    const 結果 = await セッション.judgeEnglishOrigin('コントロール')

    expect(結果.englishWord).toBe('control')
  })

  it('複合語はパーツの英単語を正規化して返す', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'compound',
        origin: 'wasei_eigo',
        englishWord: 'aluminum sash',
        parts: [
          { japanese: 'アルミ', englishWord: ' Aluminium ' },
          { japanese: 'サッシ', englishWord: 'sash' },
        ],
        note: '英単語を組み合わせた複合語です。',
      }),
    )
    const セッション = await createNanoSession()

    const 結果 = await セッション.judgeEnglishOrigin('アルミサッシ')

    expect(結果).toEqual({
      inputType: 'compound',
      isEnglishOrigin: true,
      englishWord: 'aluminum sash',
      parts: [
        { japanese: 'アルミ', englishWord: 'aluminium' },
        { japanese: 'サッシ', englishWord: 'sash' },
      ],
      note: '英単語を組み合わせた複合語です。',
    })
  })

  it('英語由来でないパーツの englishWord は null に正規化する', async () => {
    // 「窓サッシ」の「窓」のように英語に対応しないパーツは空文字で返る想定
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'compound',
        origin: 'japanese',
        englishWord: '',
        parts: [
          { japanese: '窓', englishWord: '' },
          { japanese: 'サッシ', englishWord: 'sash' },
        ],
        note: '日本語とカタカナ語の複合語です。',
      }),
    )
    const セッション = await createNanoSession()

    const 結果 = await セッション.judgeEnglishOrigin('窓サッシ')

    expect(結果.parts).toEqual([
      { japanese: '窓', englishWord: null },
      { japanese: 'サッシ', englishWord: 'sash' },
    ])
  })

  it('single_word の場合はモデルが parts を返しても空配列に正規化する', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'single_word',
        origin: 'english',
        englishWord: 'control',
        parts: [{ japanese: 'コントロール', englishWord: 'control' }],
        note: '',
      }),
    )
    const セッション = await createNanoSession()

    const 結果 = await セッション.judgeEnglishOrigin('コントロール')

    expect(結果.parts).toEqual([])
  })

  it('文章の入力は inputType: sentence として返す', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'sentence',
        origin: 'japanese',
        englishWord: '',
        parts: [],
        note: '文章です。',
      }),
    )
    const セッション = await createNanoSession()

    const 結果 = await セッション.judgeEnglishOrigin('これはペンです')

    expect(結果.inputType).toBe('sentence')
  })

  it('出力に inputType や parts が無い旧形式なら GeminiNanoError を投げる（fail-fast）', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({ origin: 'english', englishWord: 'control', note: '' }),
    )
    const セッション = await createNanoSession()

    await expect(セッション.judgeEnglishOrigin('コントロール')).rejects.toThrow(GeminiNanoError)
  })

  it('モデルが不正な JSON を返したら GeminiNanoError を投げる（fail-fast）', async () => {
    promptモック.mockResolvedValue('これはJSONではありません')
    const セッション = await createNanoSession()

    await expect(セッション.judgeEnglishOrigin('コントロール')).rejects.toThrow(GeminiNanoError)
  })

  it('JSON でも期待した形でなければ GeminiNanoError を投げる（fail-fast）', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({ origin: '分類できません', englishWord: 123 }),
    )
    const セッション = await createNanoSession()

    await expect(セッション.judgeEnglishOrigin('コントロール')).rejects.toThrow(GeminiNanoError)
  })
})

describe('NanoSession.explainWord', () => {
  it('解説テキストを前後の空白を除いて返す', async () => {
    promptモック.mockResolvedValue('\n control は「制御」を意味する名詞・動詞です。 \n')
    const セッション = await createNanoSession()

    const 解説 = await セッション.explainWord('control', 'コントロール')

    expect(解説).toBe('control は「制御」を意味する名詞・動詞です。')
    expect(promptモック.mock.calls[0][0]).toContain('control')
  })
})

describe('NanoSession.makeExampleSentences', () => {
  it('英語と日本語訳のペアを 3 つ返す', async () => {
    const 例文リスト = [
      { english: 'I can control it.', japanese: '私はそれをコントロールできます。' },
      { english: 'Stay in control.', japanese: '冷静さを保ちなさい。' },
      { english: 'The remote control is broken.', japanese: 'リモコンが壊れています。' },
    ]
    promptモック.mockResolvedValue(JSON.stringify({ examples: 例文リスト }))
    const セッション = await createNanoSession()

    await expect(セッション.makeExampleSentences('control')).resolves.toEqual(例文リスト)
  })

  it('例文が 1 つも得られなければ GeminiNanoError を投げる（fail-fast）', async () => {
    promptモック.mockResolvedValue(JSON.stringify({ examples: [] }))
    const セッション = await createNanoSession()

    await expect(セッション.makeExampleSentences('control')).rejects.toThrow(GeminiNanoError)
  })

  it('例文の形が不正なら GeminiNanoError を投げる（fail-fast）', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({ examples: [{ english: 'I can control it.' }] }),
    )
    const セッション = await createNanoSession()

    await expect(セッション.makeExampleSentences('control')).rejects.toThrow(GeminiNanoError)
  })
})

describe('NanoSession のタイムアウト', () => {
  it('prompt が制限時間内に完了しなければ GeminiNanoError を投げる（ハングさせない）', async () => {
    vi.useFakeTimers()
    try {
      // 永遠に解決しない prompt をモック（実機で確認したハングの再現）
      promptモック.mockImplementation(() => new Promise(() => {}))
      const セッション = await createNanoSession()

      const 判定Promise = セッション.judgeEnglishOrigin('コントロール')
      const 検証Promise = expect(判定Promise).rejects.toThrow(GeminiNanoError)
      // 初回のタイムアウト + セッション再作成後の再試行のタイムアウトの 2 回分進める
      await vi.advanceTimersByTimeAsync(PROMPT_TIMEOUT_MS + 1000)
      await vi.advanceTimersByTimeAsync(PROMPT_TIMEOUT_MS + 1000)
      await 検証Promise
    } finally {
      vi.useRealTimers()
    }
  })

  it('prompt にはタイムアウト用の AbortSignal を渡す（推論キューを解放する）', async () => {
    promptモック.mockResolvedValue(
      JSON.stringify({
        inputType: 'single_word',
        origin: 'english',
        englishWord: 'control',
        parts: [],
        note: '',
      }),
    )
    const セッション = await createNanoSession()

    await セッション.judgeEnglishOrigin('コントロール')

    const オプション = promptモック.mock.calls[0][1]
    expect(オプション.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('NanoSession の自己修復（セッション再作成リトライ）', () => {
  // Chrome のオンデバイスモデルは 1 回の推論後にクラッシュして
  // 次の prompt が UnknownError になることがある（実機で確認）。
  // その場合は新しいセッションで 1 回だけ再試行する。

  it('prompt が失敗したら新しいセッションで 1 回だけ再試行する', async () => {
    const 二代目promptモック = vi.fn().mockResolvedValue(
      JSON.stringify({
        inputType: 'single_word',
        origin: 'english',
        englishWord: 'control',
        parts: [],
        note: '',
      }),
    )
    const 二代目destroyモック = vi.fn()
    promptモック.mockRejectedValue(new DOMException('kErrorUnknown', 'UnknownError'))
    createモック
      .mockResolvedValueOnce(セッションモック)
      .mockResolvedValueOnce({ prompt: 二代目promptモック, destroy: 二代目destroyモック })

    const セッション = await createNanoSession()
    const 結果 = await セッション.judgeEnglishOrigin('コントロール')

    expect(結果.englishWord).toBe('control')
    // 壊れた初代セッションは破棄され、セッションが作り直されている
    expect(destroyモック).toHaveBeenCalled()
    expect(createモック).toHaveBeenCalledTimes(2)
    // 再試行は同じプロンプトで行われる
    expect(二代目promptモック.mock.calls[0][0]).toBe(promptモック.mock.calls[0][0])
  })

  it('再試行も失敗したら GeminiNanoError を投げる（無限リトライしない）', async () => {
    promptモック.mockRejectedValue(new DOMException('kErrorUnknown', 'UnknownError'))
    createモック.mockResolvedValue(セッションモック)

    const セッション = await createNanoSession()

    await expect(セッション.judgeEnglishOrigin('コントロール')).rejects.toThrow(GeminiNanoError)
    // 初回 + 再試行の 2 回だけ
    expect(promptモック).toHaveBeenCalledTimes(2)
  })
})

describe('NanoSession.destroy', () => {
  it('内部セッションの destroy を呼ぶ', async () => {
    const セッション = await createNanoSession()
    セッション.destroy()
    expect(destroyモック).toHaveBeenCalled()
  })
})
