import { useQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerKey, LEDGER_LIST } from '../me/ledgerKey'
import { fetchMonthlyStats } from './monthlyStats'

/**
 * 월별 통계의 캐시 키. 장부 앞부분 아래에 두어 거래를 저장하거나 지우면(장부 무효화) 함께 다시 받는다.
 * 통계는 기기에 저장하지 않는다(P-902). 이 캐시는 메모리에만 있어 앱을 닫으면 사라진다.
 */
export function monthlyStatsKey(ledgerId: string, month: string) {
  return [...ledgerKey(ledgerId, 'stats'), 'monthly', month] as const
}

/** 현재 장부의 한 달 통계(E-01, F-301) */
export function useMonthlyStats(month: string) {
  const ledger = useCurrentLedger()
  return useQuery({
    queryKey: monthlyStatsKey(ledger.id, month),
    queryFn: () => fetchMonthlyStats(ledger.id, month),
    meta: LEDGER_LIST,
  })
}
