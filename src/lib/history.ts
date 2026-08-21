/**
 * 判定履歴の永続化（localStorage）。
 *
 * 判定結果をクライアント側にのみ保存し、過去の判定をいつでも
 * 見返せるようにします。サーバーには一切送信しません。
 */
import type { HistoryEntry, JudgeResult } from '../types'

/** localStorage に履歴を保存するキー */
export const HISTORY_STORAGE_KEY = 'sorette-eigo:history'

/** 保存する履歴の上限件数。超えた分は古いものから削除します。 */
export const MAX_HISTORY_ENTRIES = 100

/**
 * 保存済みの履歴データが読み込めない（破損している）ことを表すエラー。
 *
 * fail-fast の方針により、壊れたデータを黙って捨てることはせず、
 * このエラーを UI 側で捕捉して利用者に復旧手段（履歴クリア）を提示します。
 */
export class HistoryLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'HistoryLoadError'
  }
}

/**
 * 保存済みの履歴を新しい順（先頭が最新）で読み込みます。
 *
 * @throws {HistoryLoadError} 保存データが JSON として不正、または配列でない場合
 */
export function loadHistory(): HistoryEntry[] {
  const 保存データ = localStorage.getItem(HISTORY_STORAGE_KEY)
  if (保存データ === null) {
    return []
  }

  let パース結果: unknown
  try {
    パース結果 = JSON.parse(保存データ)
  } catch (cause) {
    throw new HistoryLoadError('履歴データが壊れています（JSON パース失敗）', { cause })
  }

  if (!Array.isArray(パース結果)) {
    throw new HistoryLoadError('履歴データが壊れています（配列ではありません）')
  }

  return パース結果 as HistoryEntry[]
}

/**
 * 判定結果を履歴に追加して保存します。
 *
 * @param result - 保存する判定結果
 * @param judgedAt - 判定日時（エポックミリ秒）。省略時は現在時刻
 * @returns ID と判定日時が付与された履歴エントリ
 */
export function addHistoryEntry(result: JudgeResult, judgedAt: number = Date.now()): HistoryEntry {
  const 新エントリ: HistoryEntry = {
    ...result,
    id: crypto.randomUUID(),
    judgedAt,
  }

  // 既存データが壊れている場合は loadHistory が throw する。
  // 追加操作では新エントリを守るため、壊れた履歴は捨てて作り直す。
  let 既存履歴: HistoryEntry[]
  try {
    既存履歴 = loadHistory()
  } catch {
    既存履歴 = []
  }

  const 更新後履歴 = [新エントリ, ...既存履歴].slice(0, MAX_HISTORY_ENTRIES)
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(更新後履歴))
  return 新エントリ
}

/**
 * 保存済みの履歴をすべて削除します。
 * 履歴データが壊れた場合の復旧手段としても機能します。
 */
export function clearHistory(): void {
  localStorage.removeItem(HISTORY_STORAGE_KEY)
}
