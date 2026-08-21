/**
 * アプリ全体の統合コンポーネント。
 *
 * 「それって英語？」— 英語禁止プレイ中の配信者向けに、日本語の単語が
 * 英語由来かどうかをその場で判定するサービスのルートコンポーネントです。
 *
 * 状態遷移:
 * 1. 起動時に Gemini Nano の可用性を確認
 * 2. 未ダウンロードならユーザー操作でモデルをダウンロード
 * 3. 単語を受け取り、判定パイプラインを実行して結果を表示
 * 4. 判定結果は localStorage の履歴に保存
 */
import { useEffect, useState } from 'react'
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

  /** 履歴をすべて削除する */
  const 履歴をクリアする = () => {
    clearHistory()
    set履歴([])
    set履歴破損(false)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          それって<span className="app-title__accent">英語</span>？
        </h1>
        <p className="app-tagline">
          英語禁止プレイのお供に。カタカナ語が英語かどうかをその場で判定
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

        {判定結果 !== null && <ResultView result={判定結果} />}

        {/* 途中結果のカードの下に「次のフェーズを生成中」であることを示す */}
        {判定中ステップ !== null && (
          <p className="judging" aria-live="polite">
            <span className="judging__cursor" aria-hidden="true">▚</span>
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

        <HistoryList entries={履歴} onSelect={set判定結果} onClear={履歴をクリアする} />
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
