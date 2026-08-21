/**
 * InputForm（単語入力フォーム）のテスト。
 *
 * 入力・送信の基本動作に加えて、日本語入力（IME）変換確定の Enter で
 * 誤送信されないこと（isComposing チェック）を検証します。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputForm } from './InputForm'

describe('InputForm', () => {
  it('単語を入力して「判定する」ボタンで送信できる', async () => {
    const onSubmitモック = vi.fn()
    render(<InputForm disabled={false} onSubmit={onSubmitモック} />)

    await userEvent.type(screen.getByRole('textbox'), 'コントロール')
    await userEvent.click(screen.getByRole('button', { name: '判定する' }))

    expect(onSubmitモック).toHaveBeenCalledWith('コントロール')
  })

  it('Enter キーで送信できる', () => {
    const onSubmitモック = vi.fn()
    render(<InputForm disabled={false} onSubmit={onSubmitモック} />)
    const 入力欄 = screen.getByRole('textbox')

    fireEvent.change(入力欄, { target: { value: 'クラフト' } })
    fireEvent.keyDown(入力欄, { key: 'Enter' })

    expect(onSubmitモック).toHaveBeenCalledWith('クラフト')
  })

  it('IME 変換確定の Enter（isComposing: true）では送信しない', () => {
    const onSubmitモック = vi.fn()
    render(<InputForm disabled={false} onSubmit={onSubmitモック} />)
    const 入力欄 = screen.getByRole('textbox')

    fireEvent.change(入力欄, { target: { value: 'こんとろーる' } })
    fireEvent.keyDown(入力欄, { key: 'Enter', isComposing: true })

    expect(onSubmitモック).not.toHaveBeenCalled()
  })

  it('空文字・空白のみでは送信しない', async () => {
    const onSubmitモック = vi.fn()
    render(<InputForm disabled={false} onSubmit={onSubmitモック} />)
    const 入力欄 = screen.getByRole('textbox')

    await userEvent.click(screen.getByRole('button', { name: '判定する' }))
    fireEvent.change(入力欄, { target: { value: '   ' } })
    fireEvent.keyDown(入力欄, { key: 'Enter' })

    expect(onSubmitモック).not.toHaveBeenCalled()
  })

  it('送信すると入力欄が空になる', () => {
    render(<InputForm disabled={false} onSubmit={vi.fn()} />)
    const 入力欄 = screen.getByRole('textbox')

    fireEvent.change(入力欄, { target: { value: 'コントロール' } })
    fireEvent.keyDown(入力欄, { key: 'Enter' })

    expect(入力欄).toHaveValue('')
  })

  it('disabled のときは入力欄とボタンが無効になり送信できない', () => {
    const onSubmitモック = vi.fn()
    render(<InputForm disabled={true} onSubmit={onSubmitモック} />)
    const 入力欄 = screen.getByRole('textbox')

    expect(入力欄).toBeDisabled()
    expect(screen.getByRole('button', { name: '判定する' })).toBeDisabled()

    fireEvent.keyDown(入力欄, { key: 'Enter' })
    expect(onSubmitモック).not.toHaveBeenCalled()
  })
})
