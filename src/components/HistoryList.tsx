/**
 * 判定履歴の一覧表示。
 *
 * クライアント側（localStorage）に保存された過去の判定を新しい順に表示します。
 * エントリをクリックすると、その判定結果を再表示できます。
 */
import type { HistoryEntry, Verdict } from '../types'

interface HistoryListProps {
  /** 表示する履歴（先頭が最新） */
  entries: HistoryEntry[]
  /** エントリがクリックされたときに呼ばれる */
  onSelect: (entry: HistoryEntry) => void
  /** 「履歴をクリア」が押されたときに呼ばれる */
  onClear: () => void
}

/** 判定種別ごとのバッジ表示 */
const バッジ表示: Record<Verdict, { label: string; tone: 'out' | 'safe' | 'unknown' }> = {
  english: { label: 'アウト', tone: 'out' },
  english_compound: { label: '英語入り', tone: 'out' },
  not_english: { label: 'セーフ', tone: 'safe' },
  not_in_dictionary: { label: '辞書なし', tone: 'unknown' },
}

/**
 * 判定日時を「8/21 10:00」のような短い形式に整形します。
 */
function 日時を整形する(epochMs: number): string {
  return new Date(epochMs).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 判定履歴を一覧表示するコンポーネント。
 */
export function HistoryList({ entries, onSelect, onClear }: HistoryListProps) {
  return (
    <section className="history">
      <div className="history__header">
        <h2 className="history__title">判定履歴</h2>
        {entries.length > 0 && (
          <button className="history__clear" type="button" onClick={onClear}>
            履歴をクリア
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="history__empty">まだ履歴がありません</p>
      ) : (
        <ul className="history__list">
          {entries.map((entry) => {
            const バッジ = バッジ表示[entry.verdict]
            return (
              <li key={entry.id}>
                <button
                  className="history__item"
                  type="button"
                  onClick={() => onSelect(entry)}
                >
                  <span className={`badge badge--${バッジ.tone}`}>{バッジ.label}</span>
                  <span className="history__input">{entry.input}</span>
                  {entry.englishWord !== null && (
                    <span className="history__word">{entry.englishWord}</span>
                  )}
                  <time className="history__time">{日時を整形する(entry.judgedAt)}</time>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
