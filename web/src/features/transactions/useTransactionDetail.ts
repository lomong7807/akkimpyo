import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useState } from 'react'
import { isMonth } from '../../lib/calendarDate'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerKey } from '../me/ledgerKey'
import { fetchTransaction, type ListedTransaction, type TransactionPage } from './transactions'

/**
 * 거래 하나의 캐시 키(장부 앞부분 + transactions + id). 거래를 저장하거나 지우면 장부 앞부분을 무효로 만들어 이것도 다시 받는다.
 * 목록의 키(장부 앞부분 + transactions + 달)와 자리가 같고, 달과 id는 모양이 달라 섞이지 않는다.
 */
export function transactionKey(ledgerId: string, id: string) {
  return [...ledgerKey(ledgerId, 'transactions'), id] as const
}

/** 현재 장부의 거래 하나(D-06). 휴지통에 있으면 deletedAt이 차서 온다. */
export function useTransactionDetail(id: string) {
  const ledger = useCurrentLedger()
  return useQuery({ queryKey: transactionKey(ledger.id, id), queryFn: () => fetchTransaction(ledger.id, id) })
}

/**
 * 내역(D-01)에서 받아 둔 같은 거래. 목록에서 들어오면 상세를 받는 동안 목록에 있던 값을 먼저 보인다(D-06 상태).
 * 화면을 열 때 한 번만 찾는다. 없으면(주소로 바로 열었으면) 없다.
 */
export function useListedTransaction(id: string): ListedTransaction | undefined {
  const ledger = useCurrentLedger()
  const queryClient = useQueryClient()
  const [listed] = useState(() =>
    queryClient
      .getQueriesData<InfiniteData<TransactionPage>>({ queryKey: ledgerKey(ledger.id, 'transactions') })
      .filter(([key, data]) => isMonth(String(key.at(-1))) && data !== undefined)
      .flatMap(([, data]) => data!.pages.flatMap((page) => page.items))
      .find((item) => item.id.toLowerCase() === id),
  )
  return listed
}
