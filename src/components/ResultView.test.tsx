/**
 * ResultView（判定結果表示）のテスト。
 *
 * 3 種類の判定結果（英語 / 英語でない / 辞書に無い）それぞれで
 * 適切な情報が表示されることを検証します。
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultView } from './ResultView'
import type { JudgeResult } from '../types'

const 英語の判定結果: JudgeResult = {
  input: 'コントロール',
  verdict: 'english',
  englishWord: 'control',
  note: '英語の control が語源のカタカナ語です。',
  dictionary: {
    exists: true,
    phonetic: '/kənˈtɹəʊl/',
    meanings: [{ partOfSpeech: 'noun', definition: 'The ability to influence.' }],
  },
  explanation: 'control は「制御」を意味する名詞・動詞です。',
  examples: [
    { english: 'I can control it.', japanese: '私はそれをコントロールできます。' },
    { english: 'Stay in control.', japanese: '冷静さを保ちなさい。' },
    { english: 'The remote control is broken.', japanese: 'リモコンが壊れています。' },
  ],
}

describe('ResultView', () => {
  it('英語の場合は判定・英単語・発音・解説・例文をすべて表示する', () => {
    render(<ResultView result={英語の判定結果} />)

    expect(screen.getByText('英語です！')).toBeInTheDocument()
    expect(screen.getByText('control')).toBeInTheDocument()
    expect(screen.getByText('/kənˈtɹəʊl/')).toBeInTheDocument()
    expect(screen.getByText('英語の control が語源のカタカナ語です。')).toBeInTheDocument()
    expect(screen.getByText('control は「制御」を意味する名詞・動詞です。')).toBeInTheDocument()
    expect(screen.getByText('I can control it.')).toBeInTheDocument()
    expect(screen.getByText('私はそれをコントロールできます。')).toBeInTheDocument()
    expect(screen.getByText('Stay in control.')).toBeInTheDocument()
    expect(screen.getByText('The remote control is broken.')).toBeInTheDocument()
  })

  it('予備辞書（Datamuse）で確認した場合はその旨を表示する', () => {
    const 予備辞書の結果: JudgeResult = {
      ...英語の判定結果,
      dictionary: {
        exists: true,
        phonetic: null,
        meanings: [{ partOfSpeech: 'noun', definition: 'An influence or authority.' }],
        source: 'datamuse',
      },
    }
    render(<ResultView result={予備辞書の結果} />)

    expect(screen.getByText(/予備辞書（Datamuse）で確認しました/)).toBeInTheDocument()
  })

  it('メイン辞書で確認した場合は予備辞書の注記を表示しない', () => {
    const メイン辞書の結果: JudgeResult = {
      ...英語の判定結果,
      dictionary: { ...英語の判定結果.dictionary!, source: 'dictionaryapi' },
    }
    render(<ResultView result={メイン辞書の結果} />)

    expect(screen.queryByText(/予備辞書/)).not.toBeInTheDocument()
  })

  it('英語でない場合はセーフ判定と補足のみ表示する', () => {
    const 結果: JudgeResult = {
      input: 'もちもち',
      verdict: 'not_english',
      englishWord: null,
      note: '日本語固有の擬態語です。',
      dictionary: null,
      explanation: null,
      examples: [],
    }
    render(<ResultView result={結果} />)

    expect(screen.getByText('英語ではなさそう')).toBeInTheDocument()
    expect(screen.getByText('日本語固有の擬態語です。')).toBeInTheDocument()
    expect(screen.queryByText('例文')).not.toBeInTheDocument()
  })

  it('辞書に無い場合はその旨と推定された英単語を表示する', () => {
    const 結果: JudgeResult = {
      input: 'サラリーマン',
      verdict: 'not_in_dictionary',
      englishWord: 'sarariman',
      note: '和製英語の可能性があります。',
      dictionary: { exists: false, phonetic: null, meanings: [] },
      explanation: null,
      examples: [],
    }
    render(<ResultView result={結果} />)

    expect(screen.getByText('辞書に見つかりませんでした')).toBeInTheDocument()
    expect(screen.getByText('sarariman')).toBeInTheDocument()
    expect(screen.getByText('和製英語の可能性があります。')).toBeInTheDocument()
  })
})
