import type { QueryKey } from '@tanstack/react-query'
import type { Kept } from '../me/ledgerCopy'
import { useReceivedAt } from './receivedAt'
import { useConnection } from './useConnection'

/*
 * 기기에 저장하는 읽기 화면(홈, 내역, 계좌 목록, 카테고리, 거래 상세)이 보일 값을 고르는 규칙(00-common 4.3, 4.5, F-908, N-03, #238).
 * - 서버의 값이 있으면 그것을 보인다. 연결이 없거나 다시 받지 못했으면 그 값을 받은 시각을 "{시각} 기준"으로 붙인다.
 * - 없으면 기기에 남긴 값을 보인다. 연결이 있고 받는 중이면 뼈대 대신 먼저 보이고(4.5), 연결이 없거나 받지 못했으면 기준 시각을
 *   붙인다. 새 값이 오면 바꾼다.
 * - 둘 다 없으면 받는 중이거나(뼈대) 불러오지 못한 것이다. 불러오지 못했을 때의 문구는 연결에 따라 다르다(LoadFailureHere).
 */

/** 서버 조회에서 고르는 데 보는 것(TanStack의 조회 결과) */
export interface ServerResult<T> {
  data: T | undefined
  isError: boolean
  isFetchedAfterMount: boolean
}

export type Shown<T> =
  | {
      state: 'ready'
      data: T
      /** 붙일 기준 시각(받은 시각, 밀리초). 연결이 있고 새로 받은 값이면 없다 */
      basis?: number
    }
  | { state: 'loading' }
  | { state: 'failed' }

/** 위의 규칙. `receivedAt`은 서버의 값을 받은 시각, `kept`는 기기에 남긴 값(읽는 중이면 undefined, 없으면 null)이다. */
export function chooseShown<T>(
  server: ServerResult<T>,
  receivedAt: number | undefined,
  kept: Kept<T> | null | undefined,
  online: boolean,
): Shown<T> {
  // 다시 받는 동안에는 isError가 풀리므로, 값이 없으면 이 화면에서 받아 본 적이 있는지로 본다
  const failed = server.data === undefined ? server.isFetchedAfterMount : server.isError
  const stale = !online || failed
  if (server.data !== undefined) return { state: 'ready', data: server.data, basis: stale ? receivedAt : undefined }
  if (kept) return { state: 'ready', data: kept.value, basis: stale ? kept.receivedAt : undefined }
  if (kept === undefined) return { state: 'loading' }
  return stale ? { state: 'failed' } : { state: 'loading' }
}

/** 화면의 서버 조회(키 `queryKey`)와 기기에 남긴 값으로 고른다. */
export function useShown<T>(server: ServerResult<T>, queryKey: QueryKey, kept: Kept<T> | null | undefined): Shown<T> {
  const online = useConnection() === 'online'
  return chooseShown(server, useReceivedAt(queryKey), kept, online)
}
