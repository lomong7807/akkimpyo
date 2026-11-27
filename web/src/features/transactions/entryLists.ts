import type { UseQueryResult } from '@tanstack/react-query'
import { createContext, use } from 'react'
import { parseAccounts, type Account } from '../accounts/accounts'
import { useAccounts } from '../accounts/useAccounts'
import { parseCategories, type Category } from '../categories/categories'
import { useCategories } from '../categories/useCategories'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { useLedgerCopy, type Kept } from '../me/ledgerCopy'

/*
 * 새 거래 입력(D-04 새 입력)의 계좌·카테고리. 기기에 있는 사본으로 바로 열고 서버의 목록이 오면 그것으로 바꾼다(D-04 상태,
 * 00-common 4.5, #234 A2). 연결이 없거나 확인하지 못한 로그인이어도 사본으로 고를 수 있다.
 * 같은 칸을 쓰는 수정(D-04 수정)은 서버의 목록만 본다(architect Q11). 읽기 화면은 #238이 따로 사본을 쓴다(connection/deviceFirst).
 */

/** 새 입력 화면 안이다. 그 안의 고르기 칸이 사본을 쓴다. */
export const EntryCopiesContext = createContext(false)

/** 새 입력이면 서버의 계좌 목록, 아직 없으면 사본. 그 밖에는 서버의 계좌 목록 그대로다. */
export function useEntryAccounts(inEntry?: boolean): UseQueryResult<Account[]> {
  const entry = use(EntryCopiesContext)
  const ledger = useCurrentLedger()
  const server = useAccounts()
  const copy = useLedgerCopy(ledger.id, 'accounts', parseAccounts, inEntry ?? entry)
  return withCopy(server, copy.data)
}

/** 새 입력이면 서버의 카테고리, 아직 없으면 사본. 그 밖에는 서버의 카테고리 그대로다. */
export function useEntryCategories(inEntry?: boolean): UseQueryResult<Category[]> {
  const entry = use(EntryCopiesContext)
  const ledger = useCurrentLedger()
  const server = useCategories()
  const copy = useLedgerCopy(ledger.id, 'categories', parseCategories, inEntry ?? entry)
  return withCopy(server, copy.data)
}

/** 서버의 목록이 아직 없고 사본이 있으면 사본을 목록으로 보인다. 받기 상태(실패, 받는 중)는 서버의 것 그대로다. */
function withCopy<T>(server: UseQueryResult<T>, copy: Kept<T> | null | undefined): UseQueryResult<T> {
  if (server.data !== undefined || copy === null || copy === undefined) return server
  return { ...server, data: copy.value } as UseQueryResult<T>
}
