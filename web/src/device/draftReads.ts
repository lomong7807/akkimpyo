import { isInstantMs, isUserId, resultOf, transact } from './deviceDb'
import type { Draft, DraftForm, DraftRow } from './drafts'

/*
 * 쓰던 값 읽기와 채운 뒤 지우기(#234 C2). 입력 화면(따로 싣는 화면)만 쓰므로 남기기·30일 지우기(drafts.ts, 첫 화면 묶음)와
 * 나눠 첫 화면 묶음에 들지 않게 한다. 로그아웃의 지우기는 userData가 한다.
 */

/** 그 사용자의 그 화면 쓰던 값. 없거나 모양이 약속과 다르면 없다. */
export async function readDraft(userId: string, form: DraftForm): Promise<Draft | undefined> {
  const row: unknown = await transact(['drafts'], 'readonly', (transaction) =>
    resultOf(transaction.objectStore('drafts').get([userId, form])),
  )
  if (!isDraftRow(row) || row.userId !== userId || row.form !== form) return undefined
  return { form: row.form, path: row.path, values: row.values, savedAt: row.savedAt }
}

export function removeDraft(userId: string, form: DraftForm): Promise<void> {
  return transact(['drafts'], 'readwrite', (transaction) => void transaction.objectStore('drafts').delete([userId, form]))
}

function isDraftRow(row: unknown): row is DraftRow {
  if (typeof row !== 'object' || row === null) return false
  const { userId, form, path, savedAt } = row as Partial<DraftRow>
  return isUserId(userId) && typeof form === 'string' && typeof path === 'string' && isInstantMs(savedAt)
}
