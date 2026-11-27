import { useQuery } from '@tanstack/react-query'
import { currentUserId, sessionUserId } from '../../api/session'
import { readCopy, saveCopy } from '../../device/copies'
import { now } from '../../lib/clock'
import { deviceKey } from './deviceKey'

/*
 * 장부마다 두는 읽기용 사본(계좌, 카테고리, 최근 한 달 내역)(ADR 006 결정 1, P-902, #234 A2, #238). 서버에서 받을 때마다
 * 통째로 바꾼다. 새 거래 입력, '확인하지 못한 로그인', 읽기 화면(연결이 없을 때와 받는 동안, 00-common 4.5)이 쓴다.
 */

export type LedgerCopyKind = 'accounts' | 'categories' | 'transactions'

/** 기기에서 읽은 사본의 값과 서버에서 받은 시각(밀리초). 화면의 "{시각} 기준"(F-908)이 받은 시각을 쓴다. */
export interface Kept<T> {
  value: T
  receivedAt: number
}

/**
 * 서버에서 받고 그 사용자의 장부 사본으로 통째로 남긴다. 보낼 때와 받은 뒤의 사용자(토큰의 sub)가 같을 때만 남긴다.
 * 보낸 때를 함께 넘겨, 그 뒤에 그 장부를 볼 수 없게 되어 사본을 지웠으면 이 응답으로 되살리지 않는다(device/copies).
 * 남기기는 기다리지 않고, 실패해도 받은 값은 그대로 준다.
 */
export async function fetchKeepingCopy<T>(ledgerId: string, kind: LedgerCopyKind, fetch: () => Promise<T>): Promise<T> {
  const user = currentUserId()
  const startedAt = now()
  const data = await fetch()
  if (user !== undefined && currentUserId() === user) {
    void saveCopy(user, ledgerId, kind, data, now(), startedAt).catch(() => {})
  }
  return data
}

/**
 * 이 탭의 기기 데이터 주인(sessionUserId)의 그 장부 사본과 받은 시각. 없거나 모양이 틀리면 null이다. 값은 `parse`로 확인한다.
 * 사용자나 장부를 모르거나 `enabled`가 아니면 읽지 않는다. 읽기만 하고 사본을 다시 쓰지 않는다(새 사본을 남기면 로그인 영역이
 * 이 조회를 무효로 만들므로 되돌이가 생기지 않는다).
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
    queryFn: async (): Promise<Kept<T> | null> => {
      const copy = await readCopy(user!, ledgerId!, kind)
      const value = copy && parse(copy.data)
      return value === undefined || copy === undefined ? null : { value, receivedAt: copy.receivedAt }
    },
    enabled: enabled && user !== undefined && ledgerId !== undefined,
    staleTime: Infinity,
  })
}

/** 그 장부 사본(useLedgerCopy)을 화면이 고르는 값으로. 읽는 중이면 없고(undefined), 없거나 읽을 수 없거나 읽지 않으면 null이다. */
export function useKeptCopy<T>(
  ledgerId: string,
  kind: LedgerCopyKind,
  parse: (value: unknown) => T | undefined,
): Kept<T> | null | undefined {
  const copy = useLedgerCopy(ledgerId, kind, parse)
  if (copy.isError || (copy.isPending && copy.fetchStatus === 'idle')) return null
  return copy.data
}
