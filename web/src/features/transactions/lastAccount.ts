import { isUuid } from '../../lib/uuid'

/*
 * 이 사용자가 이 장부에서 마지막으로 쓴 계좌(D-04 칸별 기본값, F-102). 기기에 키 하나로 둔다(security 결정).
 * 값은 믿지 않는다. 읽을 때 지금 사용자와 장부가 같고, 계좌 id가 UUID 모양이며, 받아 온 계좌 목록에 있을 때만 쓴다.
 * 로그아웃해도 지우지 않는다(planner 결정 #102). 저장소를 쓸 수 없으면 조용히 기본 규칙을 따른다.
 */

const KEY = 'akkimpyo-last-account'

interface Owner {
  userId: string | undefined
  ledgerId: string
}

/** 마지막으로 쓴 계좌. 쓸 수 없으면 없다. */
export function readLastAccount({ userId, ledgerId }: Owner, accountIds: readonly string[]): string | undefined {
  if (userId === undefined) return undefined
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return undefined
    const { userId: storedUser, ledgerId: storedLedger, accountId } = stored as Record<string, unknown>
    if (storedUser !== userId || storedLedger !== ledgerId || !isUuid(accountId)) return undefined
    return accountIds.find((id) => id === accountId)
  } catch {
    return undefined
  }
}

/** 저장에 성공한 거래의 계좌(이체는 보내는 계좌)를 적는다. */
export function rememberLastAccount({ userId, ledgerId }: Owner, accountId: string): void {
  if (userId === undefined || !isUuid(accountId)) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ userId, ledgerId, accountId }))
  } catch {
    // 저장소를 쓸 수 없으면 다음에도 기본 규칙을 따른다
  }
}
