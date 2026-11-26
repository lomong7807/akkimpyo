import { isInstantMs, isUserId, otherUsersRanges, resultOf, transact, userRange } from './deviceDb'

/*
 * 읽기용 사본(ADR 006 결정 1, P-902, #234). 서버에서 받을 때마다 통째로 바꾸고 받은 시각을 남긴다.
 * 바뀐 것만 받는 동기화는 하지 않는다. 사본은 암호화하지 않는다(ADR 006 결정 7).
 *
 * 사용자마다 메타 줄 하나에 마지막으로 확인한 로그인 시각(confirmedAt)을 둔다. 갱신이 401이면 로그인 기록은 지워져도 사본은
 * 남으므로, 사본을 지우는 "로그인이 풀린 채 30일"(confirmedAt부터)을 이 줄로 센다.
 */

/** 사본의 종류. 내 정보(me)는 사용자 단위라 장부 자리가 빈 글자다. */
export type CopyKind = 'me' | 'accounts' | 'categories'

/** 사용자 단위 사본의 장부 자리 */
export const USER_SCOPE = ''

/** 마지막으로 확인한 로그인부터 이만큼 지나면 사본을 지운다(security #72 권고, #234 결정 댓글). */
export const KEEP_COPIES_MS = 30 * 24 * 60 * 60 * 1000

interface CopyRow {
  userId: string
  scope: string
  kind: CopyKind
  receivedAt: number
  data: unknown
}

interface MetaRow {
  userId: string
  scope: typeof USER_SCOPE
  kind: 'meta'
  confirmedAt: number
}

export interface Copy {
  data: unknown
  /** 서버에서 받은 시각(밀리초) */
  receivedAt: number
}

/** 받은 사본으로 통째로 바꾼다. */
export function saveCopy(userId: string, scope: string, kind: CopyKind, data: unknown, receivedAt: number): Promise<void> {
  const row: CopyRow = { userId, scope, kind, receivedAt, data }
  return transact(['copies'], 'readwrite', (transaction) => void transaction.objectStore('copies').put(row))
}

/** 그 사용자의 사본. 없거나 줄의 주인이 다르면 없다. 저장소를 쓸 수 없으면 DeviceUnavailable을 던진다. */
export async function readCopy(userId: string, scope: string, kind: CopyKind): Promise<Copy | undefined> {
  const row: unknown = await transact(['copies'], 'readonly', (transaction) =>
    resultOf(transaction.objectStore('copies').get([userId, scope, kind])),
  )
  if (typeof row !== 'object' || row === null) return undefined
  const { userId: owner, scope: rowScope, kind: rowKind, receivedAt, data } = row as Partial<CopyRow>
  if (owner !== userId || rowScope !== scope || rowKind !== kind || !isInstantMs(receivedAt)) return undefined
  return { data, receivedAt }
}

/**
 * 로그인 기록을 쓰는 트랜잭션 안에서 부른다(loginRecord). 그 사용자가 아닌 모든 사용자의 사본을 지우고(다른 사용자가 로그인함)
 * 그 사용자의 메타 줄을 고친다.
 */
export function keepOnlyUserCopies(store: IDBObjectStore, userId: string, confirmedAt: number): void {
  otherUsersRanges(userId).forEach((range) => store.delete(range))
  const meta: MetaRow = { userId, scope: USER_SCOPE, kind: 'meta', confirmedAt }
  store.put(meta)
}

/**
 * 마지막으로 확인한 로그인부터 30일이 지난 사용자의 사본을 모두 지운다. 메타 줄이 없거나 읽을 수 없는 사용자의 사본도 지운다.
 * 앱을 열 때 한 번 부른다.
 */
export function sweepExpiredCopies(at: number): Promise<void> {
  return transact(['copies'], 'readwrite', async (transaction) => {
    const store = transaction.objectStore('copies')
    const rows: unknown[] = await resultOf(store.getAll())
    const confirmedAt = new Map<string, number | undefined>()
    for (const row of rows) {
      const { userId, kind, confirmedAt: confirmed } = (row ?? {}) as Partial<MetaRow> & { kind?: string }
      if (!isUserId(userId)) continue
      if (!confirmedAt.has(userId)) confirmedAt.set(userId, undefined)
      if (kind === 'meta' && isInstantMs(confirmed)) confirmedAt.set(userId, confirmed)
    }
    for (const [userId, confirmed] of confirmedAt) {
      if (confirmed === undefined || at - confirmed >= KEEP_COPIES_MS) store.delete(userRange(userId))
    }
  })
}
