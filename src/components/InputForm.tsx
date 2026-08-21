/**
 * 単語入力フォーム。
 *
 * 日本語の単語を入力して判定を開始するためのフォームです。
 * IME での日本語入力を前提とするため、変換確定の Enter
 * （isComposing: true）では送信しないように制御しています。
 *
 * 送信後も入力値はクリアせず残します（判定中に「いま何を判定しているか」を
 * 画面上で確認できるようにするためです）。
 */
import { useState, type KeyboardEvent } from 'react'

interface InputFormProps {
  /** 判定中など、入力を受け付けない状態かどうか */
  disabled: boolean
  /** 単語が送信されたときに呼ばれる（前後の空白は除去済み） */
  onSubmit: (word: string) => void
}

/**
 * 判定対象の単語を入力するフォームコンポーネント。
 */
export function InputForm({ disabled, onSubmit }: InputFormProps) {
  const [入力値, set入力値] = useState('')

  const 送信する = () => {
    const 単語 = 入力値.trim()
    if (単語 === '' || disabled) {
      return
    }
    onSubmit(単語)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // IME 変換確定の Enter で誤送信しないよう、必ず isComposing を確認する
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      送信する()
    }
  }

  return (
    <form
      className="input-form"
      onSubmit={(event) => {
        event.preventDefault()
        送信する()
      }}
    >
      <input
        className="input-form__field"
        type="text"
        value={入力値}
        onChange={(event) => set入力値(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="カタカナ語を入力（例: フィッシャーマン）"
        aria-label="判定する単語"
        disabled={disabled}
        autoComplete="off"
      />
      <button className="input-form__submit" type="submit" disabled={disabled}>
        判定する
      </button>
    </form>
  )
}
