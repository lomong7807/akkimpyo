import { queryOptions, useQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerKey } from '../me/ledgerKey'
import { TRANSACTION_LIST_STALE_MS } from '../transactions/useTransactionList'
import { fetchAccounts } from './accounts'

/** 잔액이 바뀌는 저장을 한 뒤에는 이 키를 무효로 만든다. */
export function accountsKey(ledgerId: string) {
  return ledgerKey(ledgerId, 'accounts')
}

/**
 * 장부의 계좌 목록을 받는 법. 현재 장부를 정하기 전(장부에 속한 화면의 문)에도 같은 캐시를 쓰도록 나눠 둔다.
 * 받은 목록은 거래 목록과 같은 30초 동안 새것으로 본다. 잔액 계산이 홈에서 가장 비싼 요청이라(perf PR #176 측정)
 * 들어올 때 첫 실행 안내를 정하려고 받은 목록을 홈이 곧바로 다시 받지 않게 한다(perf 권고 #90). 거래나 계좌를 저장하면
 * 시간과 상관없이 장부 무효화로 다시 받아 잔액이 바로 바뀐다.
 */
export function accountsQuery(ledgerId: string) {
  return queryOptions({
    queryKey: accountsKey(ledgerId),
    queryFn: () => fetchAccounts(ledgerId),
    staleTime: TRANSACTION_LIST_STALE_MS,
  })
}

/** 현재 장부의 계좌 목록 */
export function useAccounts() {
  const ledger = useCurrentLedger()
  return useQuery(accountsQuery(ledger.id))
}
