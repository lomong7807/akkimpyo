import { useQuery } from '@tanstack/react-query'
import { ApiError } from '../../api/apiError'
import { request } from '../../api/request'
import { monthOf } from '../../lib/calendarDate'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerKey, LEDGER_LIST } from '../me/ledgerKey'
import { ledgerPath } from '../me/ledgerPath'
import { isDayTotal, type DayTotal } from './transactions'
import { TRANSACTION_LIST_STALE_MS } from './useTransactionList'

/*
 * 달력용 날짜별 합계(#66의 응답 계약). 경로, 쿼리, 필드 이름은 이 파일에만 있다.
 * `GET /api/v1/ledgers/{ledgerId}/stats/daily?month=YYYY-MM` → `{ month, days: [{ date, income, expense }] }`.
 * 합계는 P-205(이체, 취소, 휴지통 제외)이고 지출도 양수다. 합계에 드는 거래가 있는 날만 날짜 순으로 오고, 날짜는 거래 날짜 그대로다
 * (시간대 변환 없음).
 */

/**
 * 장부의 한 달 날짜별 합계를 받는다. 실패하면 ApiError를 던진다. 약속과 다른 응답(다른 달, 그 달 밖의 날짜, 같은 날 두 번,
 * 날짜 순이 아님)은 일부만 쓰지 않고 모두 받지 않는다.
 */
export async function fetchDailyTotals(ledgerId: string, month: string): Promise<DayTotal[]> {
  const query = new URLSearchParams({ month })
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'stats/daily')}?${query}`)
  if (!isDailyTotals(body, month)) throw ApiError.unreadable()
  return body.days
}

function isDailyTotals(value: unknown, month: string): value is { month: string; days: DayTotal[] } {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Partial<Record<'month' | 'days', unknown>>
  if (body.month !== month || !Array.isArray(body.days)) return false
  const days: unknown[] = body.days
  return days.every(
    (day, index) =>
      isDayTotal(day) &&
      monthOf(day.date) === month &&
      (index === 0 || (days[index - 1] as DayTotal).date < day.date),
  )
}

/** 날짜별 합계의 캐시 키. 장부 앞부분 아래라 거래를 저장하거나 지우면(장부 무효화) 함께 다시 받는다. */
export function dailyTotalsKey(ledgerId: string, month: string) {
  return [...ledgerKey(ledgerId, 'stats'), 'daily', month] as const
}

/** 현재 장부의 한 달 날짜별 합계(D-02 (3)). 다시 받는 때는 거래 목록과 같다. */
export function useDailyTotals(month: string) {
  const ledger = useCurrentLedger()
  return useQuery({
    queryKey: dailyTotalsKey(ledger.id, month),
    queryFn: () => fetchDailyTotals(ledger.id, month),
    staleTime: TRANSACTION_LIST_STALE_MS,
    meta: LEDGER_LIST,
  })
}
