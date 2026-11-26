import { resultOf, transact, userRange } from './deviceDb'
import { USER_SCOPE } from './copies'

/*
 * 장부 단위로 읽기용 사본을 지운다(security Q4, #234 A2). 그 장부를 볼 수 없게 됐을 때만 부른다. 대기열은 지우지 않는다
 * (보낼 때 "보낼 수 없음"이 된다). 첫 화면 묶음에 넣지 않으려고 부르는 쪽이 동적 import로 싣는다(planner, #251).
 */

/** 그 사용자의 그 장부 사본(계좌, 카테고리)을 지운다. 장부 목록 API의 404, 장부 경로의 403 NO_LONGER_MEMBER. */
export function forgetLedgerCopies(userId: string, ledgerId: string): Promise<void> {
  return transact(['copies'], 'readwrite', (transaction) => {
    transaction.objectStore('copies').delete(IDBKeyRange.bound([userId, ledgerId], [userId, ledgerId, []]))
  })
}

/** 내 정보의 장부 목록에 없는 장부의 사본을 지운다. 사용자 단위 사본(내 정보, 메타)은 남긴다. */
export function keepCopiesOfLedgers(userId: string, ledgerIds: readonly string[]): Promise<void> {
  return transact(['copies'], 'readwrite', async (transaction) => {
    const store = transaction.objectStore('copies')
    const keys = await resultOf(store.getAllKeys(userRange(userId)))
    for (const key of keys) {
      const scope = Array.isArray(key) ? key[1] : undefined
      if (typeof scope === 'string' && scope !== USER_SCOPE && !ledgerIds.includes(scope)) store.delete(key)
    }
  })
}
