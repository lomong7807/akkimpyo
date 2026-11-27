import { useInfiniteQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerKey, LEDGER_LIST } from '../me/ledgerKey'
import { TRANSACTION_LIST_STALE_MS } from './transactionListQueries'
import { fetchDayPage, fetchTransactionPage } from './transactionPages'

/*
 * 내역과 달력이 한 쪽씩 받는 거래 목록. 홈은 쓰지 않으므로 첫 화면 JS에 들지 않게 홈의 조회(transactionListQueries.ts)와
 * 나눠 둔다(#355). 캐시 키의 모양과 새것으로 보는 시간은 transactionListQueries.ts에 적었다.
 */

/** 내역의 한 달: 달(`YYYY-MM`) */
export function transactionListKey(ledgerId: string, month: string) {
  return [...ledgerKey(ledgerId, 'transactions'), month] as const
}

/** 달력의 고른 날: { date } */
export function dayTransactionsKey(ledgerId: string, date: string) {
  return [...ledgerKey(ledgerId, 'transactions'), { date }] as const
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
    staleTime: TRANSACTION_LIST_STALE_MS,
    meta: LEDGER_LIST,
  })
}

/** 현재 장부의 하루 거래를 50건씩 받는다(달력 D-02 (5), #15 하루 모드). 나머지는 useTransactionList와 같다. */
export function useDayTransactions(date: string) {
  const ledger = useCurrentLedger()
  return useInfiniteQuery({
    queryKey: dayTransactionsKey(ledger.id, date),
    queryFn: ({ pageParam }) => fetchDayPage(ledger.id, date, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: TRANSACTION_LIST_STALE_MS,
    meta: LEDGER_LIST,
  })
}
