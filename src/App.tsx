/**
 * アプリ全体の統合コンポーネント。
 *
 * 「それってエイゴ？」— 英語禁止プレイ中の配信者向けに、日本語の単語が
 * 英語由来かどうかをその場で判定するサービスのルートコンポーネントです。
 *
 * 状態遷移:
 * 1. 起動時に Gemini Nano の可用性を確認
 * 2. 未ダウンロードならユーザー操作でモデルをダウンロード
 * 3. 単語を受け取り、判定パイプラインを実行して結果を表示
 * 4. 判定結果は localStorage の履歴に保存
 */
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { InputForm } from './components/InputForm'
import { ResultView } from './components/ResultView'
import { HistoryList } from './components/HistoryList'
import { checkAvailability, createNanoSession } from './lib/geminiNano'
import { lookupEnglishWord } from './lib/dictionary'
import { analyzeMorphemes } from './lib/morphology'
import { judgeWord, type JudgeStep } from './lib/judge'
import {
  MAX_HISTORY_ENTRIES,
  addHistoryEntry,
  clearHistory,
  loadHistory,
} from './lib/history'
import type { HistoryEntry, JudgeResult } from './types'

/** モデル（Gemini Nano）の準備状態 */
type ModelState =
  | { phase: 'checking' }
  | { phase: 'unavailable' }
  | { phase: 'needs_download' }
  | { phase: 'downloading'; progress: number }
  | { phase: 'ready' }

/** 判定パイプラインの各ステップに対応する表示ラベル */
const ステップ表示: Record<JudgeStep, string> = {
  analyzing_morphemes: '単語を分解中…',
  judging_origin: '英単語を推定中…',
  checking_dictionary: '辞書を確認中…',
  checking_parts: 'パーツごとに判定中…',
  explaining: '解説を生成中…',
  making_examples: '例文を作成中…',
}

/**
 * アプリのルートコンポーネント。
 */
export default function App() {
  const [モデル状態, setモデル状態] = useState<ModelState>({ phase: 'checking' })
  const [判定中ステップ, set判定中ステップ] = useState<JudgeStep | null>(null)
  const [判定結果, set判定結果] = useState<JudgeResult | null>(null)
  const [エラー, setエラー] = useState<string | null>(null)
  const [履歴, set履歴] = useState<HistoryEntry[]>([])
  const [履歴破損, set履歴破損] = useState(false)
  /** 判定結果の表示領域（履歴クリック時のスクロール先） */
  const 結果表示Ref = useRef<HTMLDivElement>(null)

  // 起動時: Gemini Nano の可用性チェックと履歴の読み込み
  useEffect(() => {
    let 破棄済み = false

    checkAvailability()
      .then((可用性) => {
        if (破棄済み) return
        if (可用性 === 'available') {
          setモデル状態({ phase: 'ready' })
        } else if (可用性 === 'unavailable') {
          setモデル状態({ phase: 'unavailable' })
        } else {
          // downloadable / downloading はどちらもダウンロード開始画面を出す
          setモデル状態({ phase: 'needs_download' })
        }
      })
      .catch((原因) => {
        if (破棄済み) return
        setモデル状態({ phase: 'unavailable' })
        setエラー(原因 instanceof Error ? 原因.message : String(原因))
      })

    try {
      set履歴(loadHistory())
    } catch {
      // 壊れた履歴データを検知したら、利用者に復旧手段（クリア）を提示する
      set履歴破損(true)
    }

    return () => {
      破棄済み = true
    }
  }, [])

  /** モデルのダウンロードを開始する */
  const モデルをダウンロードする = async () => {
    setエラー(null)
    setモデル状態({ phase: 'downloading', progress: 0 })
    try {
      const セッション = await createNanoSession((進捗) => {
        setモデル状態({ phase: 'downloading', progress: 進捗 })
      })
      // ダウンロード完了の確認が目的のため、セッションはすぐ破棄する
      セッション.destroy()
      setモデル状態({ phase: 'ready' })
    } catch (原因) {
      setモデル状態({ phase: 'needs_download' })
      setエラー(原因 instanceof Error ? 原因.message : String(原因))
    }
  }

  /** 単語の判定パイプラインを実行する */
  const 単語を判定する = async (単語: string) => {
    setエラー(null)
    set判定結果(null)
    set判定中ステップ('judging_origin')

    let セッション: Awaited<ReturnType<typeof createNanoSession>> | null = null
    try {
      // 判定ごとに新しいセッションを作り、前回の文脈が結果に影響しないようにする
      セッション = await createNanoSession()
      const 結果 = await judgeWord(単語, {
        analyzeMorphemes,
        judgeEnglishOrigin: (対象) => セッション!.judgeEnglishOrigin(対象),
        lookupEnglishWord,
        explainWord: (英単語, 元入力) => セッション!.explainWord(英単語, 元入力),
        makeExampleSentences: (英単語) => セッション!.makeExampleSentences(英単語),
        onStep: set判定中ステップ,
        // フェーズ完了ごとの途中結果を即座に画面へ反映する（履歴保存は最終結果のみ）
        onProgress: set判定結果,
      })

      const エントリ = addHistoryEntry(結果)
      set判定結果(結果)
      set履歴((直前) => [エントリ, ...直前].slice(0, MAX_HISTORY_ENTRIES))
      set履歴破損(false)
    } catch (原因) {
      setエラー(原因 instanceof Error ? 原因.message : String(原因))
    } finally {
      セッション?.destroy()
      set判定中ステップ(null)
    }
  }

  /** 履歴のエントリを選択して過去の判定結果を再表示し、結果の位置までスクロールで戻る */
  const 履歴の結果を表示する = (エントリ: HistoryEntry) => {
    // 結果カードが描画されてからスクロール先の位置を測るため、同期的に再レンダリングする
    flushSync(() => {
      set判定結果(エントリ)
    })
    // スクロールの滑らかさは CSS の scroll-behavior に委ねる（reduced-motion 対応のため）
    結果表示Ref.current?.scrollIntoView()
  }

  /** 履歴をすべて削除する */
  const 履歴をクリアする = () => {
    clearHistory()
    set履歴([])
    set履歴破損(false)
  }

  return (
    <div className="app">
      <header className="app-header">
        <a
          className="app-github"
          href="https://github.com/mtane0412/sorette-eigo"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub リポジトリ"
        >
          {/* GitHub のロゴ（Octicons の mark-github） */}
          <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
            />
          </svg>
        </a>
        <h1 className="app-title">
          それって<span className="app-title__accent">エイゴ</span>？
        </h1>
        <p className="app-tagline">
          英語禁止プレイのお供に。カタカナ語が英語かどうかをその場で判定
        </p>
        <p className="app-disclaimer">
          小型のAIモデルによる判定のため、間違えることが多々あります。
        </p>
      </header>

      <main className="app-main">
        {モデル状態.phase === 'checking' && (
          <p className="status">Gemini Nano を確認中…</p>
        )}

        {モデル状態.phase === 'unavailable' && (
          <section className="model-card model-card--warn">
            <h2 className="model-card__title">
              このブラウザでは Gemini Nano が利用できません
            </h2>
            <p>
              判定にはブラウザ内蔵 AI（Prompt API）が必要です。以下をお試しください。
            </p>
            <ul className="model-card__steps">
              <li>デスクトップ版 Chrome 138 以降を使う</li>
              <li>
                <code>chrome://flags/#prompt-api-for-gemini-nano</code> を Enabled にする
              </li>
              <li>
                <code>chrome://flags/#optimization-guide-on-device-model</code> を
                Enabled BypassPerfRequirement にする
              </li>
              <li>Chrome を再起動する</li>
            </ul>
          </section>
        )}

        {モデル状態.phase === 'needs_download' && (
          <section className="model-card">
            <h2 className="model-card__title">はじめに: モデルの準備</h2>
            <p>
              初回のみ、Gemini Nano のモデル（数 GB 程度）をブラウザにダウンロードします。
              ダウンロード後の判定はすべて端末の中だけで実行されます。
            </p>
            <button className="model-card__button" type="button" onClick={モデルをダウンロードする}>
              モデルをダウンロード
            </button>
          </section>
        )}

        {モデル状態.phase === 'downloading' && (
          <section className="model-card">
            <h2 className="model-card__title">モデルをダウンロード中…</h2>
            <div
              className="progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(モデル状態.progress * 100)}
            >
              <div
                className="progress__bar"
                style={{ width: `${Math.round(モデル状態.progress * 100)}%` }}
              />
            </div>
            <p className="progress__label">{Math.round(モデル状態.progress * 100)}%</p>
          </section>
        )}

        {モデル状態.phase === 'ready' && (
          <InputForm disabled={判定中ステップ !== null} onSubmit={単語を判定する} />
        )}

        {エラー !== null && (
          <div className="error" role="alert">
            <span className="error__label">エラー</span>
            {エラー}
          </div>
        )}

        {判定結果 !== null && (
          <div ref={結果表示Ref}>
            <ResultView result={判定結果} />
          </div>
        )}

        {/* 途中結果のカードの下に「次のフェーズを生成中」であることを示す */}
        {判定中ステップ !== null && (
          <p className="judging" aria-live="polite">
            <span className="judging__cursor" aria-hidden="true">●</span>
            {ステップ表示[判定中ステップ]}
          </p>
        )}

        {履歴破損 && (
          <div className="error" role="alert">
            <span className="error__label">エラー</span>
            保存されていた履歴データが壊れています。「履歴をクリア」で初期化できます。
            <button className="error__action" type="button" onClick={履歴をクリアする}>
              履歴をクリア
            </button>
          </div>
        )}

        <HistoryList
          entries={履歴}
          onSelect={履歴の結果を表示する}
          onClear={履歴をクリアする}
        />
      </main>

      <footer className="app-footer">
        <p>
          判定は Chrome 内蔵の Gemini Nano がブラウザの中だけで行います。
          入力した単語が外部に送られるのは、単語の分解（
          <a
            href="https://developer.yahoo.co.jp/webapi/jlp/ma/v2/parse.html"
            target="_blank"
            rel="noreferrer"
          >
            Yahoo!テキスト解析API
          </a>
          ）と英単語の実在チェック（
          <a href="https://dictionaryapi.dev/" target="_blank" rel="noreferrer">
            Free Dictionary API
          </a>
          、接続できないときは予備の
          <a href="https://www.datamuse.com/api/" target="_blank" rel="noreferrer">
            Datamuse API
          </a>
          ）のみです。
        </p>
      </footer>
    </div>
  )
}
