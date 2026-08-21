/**
 * 判定結果の表示。
 *
 * 英語禁止ゲームの判定札のように、結果を「スタンプ」として大きく表示し、
 * 英語の場合は英単語・発音・解説・辞書の定義・例文を続けて表示します。
 */
import type { JudgeResult, Verdict } from '../types'

interface ResultViewProps {
  /** 表示する判定結果 */
  result: JudgeResult
}

/** 判定種別ごとの表示内容（スタンプの文言と色調） */
const 判定表示: Record<
  Verdict,
  { eyebrow: string; title: string; tone: 'out' | 'safe' | 'unknown' }
> = {
  english: { eyebrow: 'OUT!', title: '英語です！', tone: 'out' },
  not_english: { eyebrow: 'SAFE', title: '英語ではなさそう', tone: 'safe' },
  not_in_dictionary: {
    eyebrow: '???',
    title: '辞書に見つかりませんでした',
    tone: 'unknown',
  },
}

/**
 * 判定結果を表示するコンポーネント。
 */
export function ResultView({ result }: ResultViewProps) {
  const 表示 = 判定表示[result.verdict]

  return (
    <section className={`result result--${表示.tone}`} aria-live="polite">
      <div className="result__stamp" key={`${result.input}-${result.verdict}`}>
        <span className="result__eyebrow">{表示.eyebrow}</span>
        <h2 className="result__title">{表示.title}</h2>
      </div>

      <p className="result__input">
      「<span>{result.input}</span>」の判定結果
      </p>

      {result.englishWord !== null && (
        <p className="result__word">
          <span className="result__english">{result.englishWord}</span>
          {result.dictionary?.phonetic && (
            <span className="result__phonetic">{result.dictionary.phonetic}</span>
          )}
        </p>
      )}

      {result.note !== '' && <p className="result__note">{result.note}</p>}

      {result.dictionary?.source === 'datamuse' && (
        <p className="result__dict-source">
          メイン辞書（Free Dictionary API）に接続できなかったため、予備辞書（Datamuse）で確認しました
        </p>
      )}

      {result.verdict === 'not_in_dictionary' && (
        <p className="result__hint">
          英語由来と推定されましたが、英語の辞書には載っていない綴りでした。
          和製英語や省略形の可能性があります。
        </p>
      )}

      {result.explanation !== null && (
        <div className="result__section">
          <h3 className="result__heading">解説</h3>
          <p className="result__explanation">{result.explanation}</p>
        </div>
      )}

      {result.dictionary !== null && result.dictionary.meanings.length > 0 && (
        <div className="result__section">
          <h3 className="result__heading">辞書の定義</h3>
          <ul className="result__meanings">
            {result.dictionary.meanings.map((meaning) => (
              <li key={meaning.partOfSpeech}>
                <span className="result__pos">{meaning.partOfSpeech}</span>
                <span className="result__definition">{meaning.definition}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.examples.length > 0 && (
        <div className="result__section">
          <h3 className="result__heading">例文</h3>
          <ol className="result__examples">
            {result.examples.map((example) => (
              <li key={example.english}>
                <p className="result__example-en">{example.english}</p>
                <p className="result__example-ja">{example.japanese}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
