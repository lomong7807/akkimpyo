import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { sessionUserId } from '../../api/session'
import { readSyncedAt } from '../../device/syncedAt'
import { deviceKey } from '../me/deviceKey'
import { useAllPending } from '../transactions/pendingTransactions'

/*
 * 동기화 상태(B-04, F-104, #235)를 기기 저장소에서 읽는다. 연결과 상관없이 바로 그린다. 바뀌면 로그인 영역(SignedInArea)이
 * 캐시를 무효로 만든다(대기열은 pendingKey, 맞춘 시각은 syncedKey).
 */

export interface PendingCounts {
  /** 대기 */
  waiting: number
  /** 보낼 수 없음 */
  rejected: number
}

/** 보내지 않은 입력 목록(B-05)의 주소(00-common 12절). B-04, 사이드바 건수 줄(2-4), 홈·내역의 보내지 않음 줄이 간다 */
export const PENDING_PATH = '/pending'

/**
 * B-04와 사이드바 건수 줄(2-4)의 이름(00-common 6.5). 보낼 수 없음이 없으면 둘째 구절을 뺀다. 누르면 목록으로 가므로
 * ", 목록 보기"를 붙인다(designer #235 Q3, #236).
 */
export function pendingSummary(total: number, rejected: number): string {
  const counts = rejected > 0 ? `보내지 않은 입력 ${total}건, 그중 보낼 수 없음 ${rejected}건` : `보내지 않은 입력 ${total}건`
  return `${counts}, 목록 보기`
}

/** 이 기기에서 이 계정이 쌓은 보내지 않은 입력의 건수(모든 장부 합계) */
export function usePendingCounts(): PendingCounts {
  const all = useAllPending()
  return useMemo(() => {
    const rejected = all.filter(({ state }) => state.kind === 'rejected').length
    return { waiting: all.length - rejected, rejected }
  }, [all])
}

/** 마지막으로 맞춘 시각 조회의 캐시 키 */
export function syncedKey(userId: string | undefined) {
  return deviceKey(userId, 'synced')
}

/** 마지막으로 맞춘 시각(밀리초). 한 번도 맞추지 못했으면 null, 읽기 전이나 읽지 못했으면 없다 */
export function useSyncedAt(): number | null | undefined {
  const user = sessionUserId()
  return useQuery({
    queryKey: syncedKey(user),
    queryFn: async () => (await readSyncedAt(user!)) ?? null,
    enabled: user !== undefined,
    staleTime: Infinity,
  }).data
}

/** 1분마다 다시 그린다. 열어 둔 채 자정이 지나면 "오늘"이 바뀐다 */
export function useEveryMinute(): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      timer = setTimeout(() => {
        setTick((count) => count + 1)
        tick()
      }, 60_000)
    }
    tick()
    return () => clearTimeout(timer)
  }, [])
}
