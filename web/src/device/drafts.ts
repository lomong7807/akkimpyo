import { isInstantMs, isUserId, resultOf, transact } from './deviceDb'

/*
 * 쓰던 값(00-common 4.1, #234 C2, 설계 7절). 로그인이 풀리는 순간 열려 있던 입력 화면의 값을 그 사용자의 것으로 남긴다.
 * 같은 계정으로 다시 로그인해 그 화면을 열면 읽어 채우고 지운다. 키의 첫 칸이 사용자 id라 다른 사용자에게 보이지 않는다(Q12).
 * 지우는 때: 읽어 채웠을 때, 로그아웃(userData), 남긴 때부터 30일(앱을 열 때, security 권고). 다른 사용자 로그인이나 404에는
 * 지우지 않는다(사용자 입력, 설계 4.3).
 */

/** 쓰던 값을 남기는 입력 화면 */
export type DraftForm =
  | 'transaction-new'
  | 'transaction-edit'
  | 'account-add'
  /** 계좌 수정(G-02 수정 모드, #243). 주소에 계좌 id가 있어 그 계좌의 화면에만 채운다 */
  | 'account-edit'
  | 'first-account'
  | 'pending-fix'
  /** 홈의 한 줄 입력칸 글과 열려 있거나 보내는 중인 결과 확인(D-05, #233) */
  | 'one-line'

/** 남긴 때부터 이만큼 지나면 앱을 열 때 지운다(security 권고, planner Q12) */
export const KEEP_DRAFTS_MS = 30 * 24 * 60 * 60 * 1000

export interface Draft {
  form: DraftForm
  /** 그 화면의 주소(경로와 쿼리). 같은 주소로 돌아왔을 때만 채운다 */
  path: string
  /** 화면이 정한 모양의 값. 읽을 때 화면이 다시 검사한다 */
  values: unknown
  /** 남긴 시각(밀리초) */
  savedAt: number
}

export interface DraftRow extends Draft {
  userId: string
}

/** 그 사용자의 쓰던 값을 한 트랜잭션으로 남긴다. 같은 화면이면 덮어쓴다. 디스크에 닿은 뒤 끝난다. */
export function keepDrafts(userId: string, drafts: readonly Draft[]): Promise<void> {
  return transact(
    ['drafts'],
    'readwrite',
    (transaction) => {
      const store = transaction.objectStore('drafts')
      for (const { form, path, values, savedAt } of drafts) {
        const row: DraftRow = { userId, form, path, values, savedAt }
        store.put(row)
      }
    },
    { durability: 'strict' },
  )
}

/** 남긴 때부터 30일이 지났거나 남긴 때를 모르는 쓰던 값을 지운다(모든 사용자). 앱을 열 때 한 번 부른다. */
export function sweepExpiredDrafts(at: number): Promise<void> {
  return transact(['drafts'], 'readwrite', async (transaction) => {
    const store = transaction.objectStore('drafts')
    const rows: unknown[] = await resultOf(store.getAll())
    for (const row of rows) {
      const { userId, form, savedAt } = (row ?? {}) as Partial<DraftRow>
      if (!isUserId(userId) || typeof form !== 'string') continue
      if (!isInstantMs(savedAt) || at - savedAt >= KEEP_DRAFTS_MS) store.delete([userId, form])
    }
  })
}
