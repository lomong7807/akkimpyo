import { useInfiniteQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerKey } from '../me/ledgerKey'
import { fetchTransactionPage } from './transactions'

/** 한 달 거래 목록의 캐시 키. 조건(달)은 자원 뒤에 둔다. 거래를 저장하면 장부 앞부분을 무효로 만들어 이것도 다시 받는다. */
export function transactionListKey(ledgerId: string, month: string) {
  return [...ledgerKey(ledgerId, 'transactions'), month] as const
}

/**
 * 현재 장부의 한 달 거래를 50건씩 받는다(P-232). 받은 쪽들은 캐시에 남아, 상세에 다녀오면 같은 높이로 바로 그린다.
 * 다음 쪽은 앞 쪽이 준 cursor로 받는다.
 */
export function useTransactionList(month: string) {
  const ledger = useCurrentLedger()
  return useInfiniteQuery({
    queryKey: transactionListKey(ledger.id, month),
    queryFn: ({ pageParam }) => fetchTransactionPage(ledger.id, month, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}
