import { queryOptions, useQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerKey, LEDGER_LIST } from '../me/ledgerKey'
import { fetchMonthTotals, fetchRecentTransactions, RECENT_COUNT } from './transactions'

/*
 * 거래 목록 API의 캐시 키와 새것으로 보는 시간, 홈이 처음 그릴 때 받는 두 조회(이번 달 합계, 최근 거래).
 * 내역과 달력의 한 쪽씩 받는 목록(useInfiniteQuery)은 홈이 쓰지 않아 첫 화면 JS에 들지 않게 useTransactionList.ts에 둔다(#355).
 */

/**
 * 받은 목록을 새것으로 보는 시간. 이 안에 상세에 다녀오거나 창에 초점이 와도 다시 받지 않는다.
 * 지나면 기본 동작대로 불러온 쪽을 모두 차례로 다시 받는다(10쪽이면 요청 10번). 거래를 저장하면 시간과 상관없이
 * 장부 무효화로 다시 받는다. 근거: perf 의견(#87, 2026-11-26), #15의 서버 측정 뒤 다시 본다.
 * 홈의 이번 달 합계와 최근 거래도 같은 목록 API라 같은 시간을 쓴다.
 */
export const TRANSACTION_LIST_STALE_MS = 30_000

/**
 * 거래 목록 캐시 키의 모양. 모두 장부 앞부분 + transactions 뒤에 조건을 둔다. 거래를 저장하거나 지우면 장부 앞부분을
 * 무효로 만들어 모두 다시 받는다. 같은 자리의 상세 키(거래 id)와 모양이 달라 섞이지 않는다.
 * - 내역의 한 달: 달(`YYYY-MM`) (useTransactionList.ts)
 * - 홈의 이번 달 합계: { month, limit: 1 }
 * - 홈의 최근 거래: { limit: 10 }
 * - 달력의 고른 날: { date } (useTransactionList.ts)
 */
export function monthTotalsKey(ledgerId: string, month: string) {
  return [...ledgerKey(ledgerId, 'transactions'), { month, limit: 1 }] as const
}

export function recentTransactionsKey(ledgerId: string) {
  return [...ledgerKey(ledgerId, 'transactions'), { limit: RECENT_COUNT }] as const
}

/** 장부의 한 달 수입·지출 합계를 받는 법. 기기에 남기는 최근 한 달(#238)도 이것으로 받아 홈과 같은 요청을 두 번 보내지 않는다 */
export function monthTotalsQuery(ledgerId: string, month: string) {
  return queryOptions({
    queryKey: monthTotalsKey(ledgerId, month),
    queryFn: () => fetchMonthTotals(ledgerId, month),
    staleTime: TRANSACTION_LIST_STALE_MS,
    meta: LEDGER_LIST,
  })
}

/** 현재 장부의 한 달 수입·지출 합계(홈의 이번 달 합계, F-111) */
export function useMonthTotals(month: string) {
  const ledger = useCurrentLedger()
  return useQuery(monthTotalsQuery(ledger.id, month))
}

/** 현재 장부 전체의 최근 거래 10건(홈의 최근 거래, F-113) */
export function useRecentTransactions() {
  const ledger = useCurrentLedger()
  return useQuery({
    queryKey: recentTransactionsKey(ledger.id),
    queryFn: () => fetchRecentTransactions(ledger.id),
    staleTime: TRANSACTION_LIST_STALE_MS,
    meta: LEDGER_LIST,
  })
}
