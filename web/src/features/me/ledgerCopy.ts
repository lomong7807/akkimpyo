import { useQuery } from '@tanstack/react-query'
import { currentUserId, sessionUserId } from '../../api/session'
import { readCopy, saveCopy } from '../../device/copies'
import { now } from '../../lib/clock'
import { deviceKey } from './deviceKey'

/*
 * 장부마다 두는 읽기용 사본(계좌, 카테고리)(ADR 006 결정 1, P-902, #234 A2). 서버에서 받을 때마다 통째로 바꾼다.
 * #234는 새 거래 입력과 '확인하지 못한 로그인'에서만 사본을 쓴다. 읽기 화면에 사본을 먼저 보이는 것은 #238이 같은 기기 키로
 * 맞춘다(architect Q11).
 */

export type LedgerCopyKind = 'accounts' | 'categories'

/**
 * 서버에서 받고 그 사용자의 장부 사본으로 통째로 남긴다. 보낼 때와 받은 뒤의 사용자(토큰의 sub)가 같을 때만 남긴다.
 * 남기기는 기다리지 않고, 실패해도 받은 값은 그대로 준다.
 */
export async function fetchKeepingCopy<T>(ledgerId: string, kind: LedgerCopyKind, fetch: () => Promise<T>): Promise<T> {
  const user = currentUserId()
  const data = await fetch()
  if (user !== undefined && currentUserId() === user) void saveCopy(user, ledgerId, kind, data, now()).catch(() => {})
  return data
}

/**
 * 이 탭의 기기 데이터 주인(sessionUserId)의 그 장부 사본. 없거나 모양이 틀리면 null이다. 값은 `parse`로 확인한다.
 * 사용자나 장부를 모르거나 `enabled`가 아니면 읽지 않는다.
 */
export function useLedgerCopy<T>(
  ledgerId: string | undefined,
  kind: LedgerCopyKind,
  parse: (value: unknown) => T | undefined,
  enabled = true,
) {
  const user = sessionUserId()
  return useQuery({
    queryKey: deviceKey(user, kind, ledgerId ?? ''),
    queryFn: async () => {
      const copy = await readCopy(user!, ledgerId!, kind)
      return (copy && parse(copy.data)) ?? null
    },
    enabled: enabled && user !== undefined && ledgerId !== undefined,
    staleTime: Infinity,
  })
}
