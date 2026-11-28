import { announce } from './changes'
import { USER_SCOPE } from './copies'
import { resultOf, transact } from './deviceDb'
import { sentAtOf, type SentRow } from './syncedAt'

/* 마지막으로 맞춘 시각 가운데 보낸 시각을 남긴다(B-04 (2-3), #235). 읽기는 syncedAt.ts에 있다. */

/** 보내기에 성공한 시각을 남긴다. 남긴 시각보다 앞이면 그대로 둔다(늦게 끝난 보내기가 시각을 되돌리지 않는다). */
export async function markSent(userId: string, at: number): Promise<void> {
  const changed = await transact(['copies'], 'readwrite', async (transaction) => {
    const store = transaction.objectStore('copies')
    const last = sentAtOf(await resultOf(store.get([userId, USER_SCOPE, 'sent'])))
    if (last !== undefined && last >= at) return false
    const row: SentRow = { userId, scope: USER_SCOPE, kind: 'sent', at }
    store.put(row)
    return true
  })
  if (changed) announce('synced')
}
