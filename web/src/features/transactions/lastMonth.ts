import { useQuery, useQueryClient } from '@tanstack/react-query'
import { currentUserId } from '../../api/session'
import { addDays, isDate, isMonth, today } from '../../lib/calendarDate'
import { useReceivedAt } from '../connection/receivedAt'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { fetchKeepingCopy, useKeptCopy, type Kept } from '../me/ledgerCopy'
import { ledgerKey, LEDGER_LIST } from '../me/ledgerKey'
import {
  isDayTotal,
  isIncomeAndExpense,
  isListedTransaction,
  type DayTotal,
  type IncomeAndExpense,
  type ListedTransaction,
} from './transactions'
import { monthTotalsQuery, TRANSACTION_LIST_STALE_MS } from './transactionListQueries'

/*
 * 기기에 남기는 장부의 최근 한 달 내역(P-902, ADR 006 결정 1, #238). 연결되어 받을 때마다 통째로 바꾸고, 연결이 없을 때와
 * 서버의 값을 받는 동안 홈, 내역, 거래 상세가 이것으로 보인다(F-908, 00-common 4.5). 받는 코드(fetchLastMonth)는 따로 싣고,
 * 기기에서 읽고 모양을 보는 코드는 연결 없이도 쓰도록 첫 화면 묶음에 둔다(architect #238).
 */

/** "최근 한 달"은 기기의 오늘을 포함한 지난 31일이다(P-902). */
export const KEPT_DAYS = 31

export interface MonthTotals {
  /** `YYYY-MM` */
  month: string
  /** 그 달 전체의 합계(P-205) */
  totals: IncomeAndExpense
}

/** 기기에 남긴 최근 한 달. 화면이 "저장 범위"라고 할 때는 오늘로 다시 세지 않고 이 사본의 from·to를 쓴다(architect #238 B). */
export interface LastMonth {
  /** 저장 범위의 첫날. 받은 날 기기의 오늘에서 30일 앞이다. 쪽 상한에서 멈췄으면 그보다 뒤다 */
  from: string
  /** 저장 범위의 끝날. 받은 날의 기기의 오늘이다 */
  to: string
  /** 저장 범위의 거래. 서버가 정한 순서(목록과 같다)이고 휴지통의 거래는 없다 */
  items: ListedTransaction[]
  /** 받은 거래의 날짜마다 그날 전체의 합계 */
  days: DayTotal[]
  /** 저장 범위가 걸친 달마다 그 달 전체의 합계. 앞의 달부터다 */
  months: MonthTotals[]
  /** 쪽 상한에서 멈춰 31일을 다 받지 못했다(from이 그만큼 뒤다) */
  truncated: boolean
}

/** 기기에서 읽은 최근 한 달. 받은 그대로의 모양이 아니면 없다(값은 믿지 않는다). */
export function parseLastMonth(value: unknown): LastMonth | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { from, to, items, days, months, truncated } = value as Partial<Record<keyof LastMonth, unknown>>
  // 쪽 상한에서 잘려 하루도 남지 않으면 from이 to의 다음 날이다
  if (typeof from !== 'string' || typeof to !== 'string' || !isDate(from) || !isDate(to) || from > addDays(to, 1)) {
    return undefined
  }
  const inRange = (date: string) => date >= from && date <= to
  const valid =
    Array.isArray(items) &&
    items.every((item) => isListedTransaction(item) && inRange(item.occurredOn)) &&
    Array.isArray(days) &&
    days.every((day) => isDayTotal(day) && inRange(day.date)) &&
    Array.isArray(months) &&
    months.every(isMonthTotals) &&
    typeof truncated === 'boolean'
  return valid ? ({ from, to, items, days, months, truncated } as LastMonth) : undefined
}

function isMonthTotals(value: unknown): value is MonthTotals {
  const { month, totals } = (value ?? {}) as Partial<Record<keyof MonthTotals, unknown>>
  return typeof month === 'string' && isMonth(month) && isIncomeAndExpense(totals)
}

/** 최근 한 달 조회의 캐시 키. 장부 앞부분 아래라 거래를 저장하면(장부 무효화) 다시 받는다. 목록의 달·상세의 id와 섞이지 않는다 */
export function lastMonthKey(ledgerId: string) {
  return [...ledgerKey(ledgerId, 'transactions'), { days: KEPT_DAYS }] as const
}

/**
 * 현재 장부의 최근 한 달을 서버에서 받아 그 사용자의 사본으로 통째로 남긴다. 보낼 때와 받은 뒤의 사용자가 같을 때만 남기고
 * (fetchKeepingCopy), 거래의 쪽은 모두 그 사용자의 토큰으로만 보낸다. 받기는 홈(앱의 시작 화면)이 시작하고, `fetch`가 거짓이면
 * 받지 않고 받아 둔 것만 읽는다(내역, 거래 상세). 거래를 저장하면 장부 무효화로 홈에서 다시 받는다.
 */
function useLastMonthQuery(fetch: boolean) {
  const ledger = useCurrentLedger()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: lastMonthKey(ledger.id),
    queryFn: () => {
      const user = currentUserId()
      const sender = user === undefined ? undefined : { startedBy: user }
      // 달 합계는 홈의 이번 달 합계와 같은 캐시로 받는다(같은 요청을 두 번 보내지 않는다)
      const monthTotals = (month: string) => queryClient.fetchQuery(monthTotalsQuery(ledger.id, month))
      return fetchKeepingCopy(ledger.id, 'transactions', async () => {
        const { fetchLastMonth } = await import('./fetchLastMonth')
        return fetchLastMonth(ledger.id, today(), { sender, monthTotals })
      })
    },
    enabled: fetch,
    meta: LEDGER_LIST,
    staleTime: TRANSACTION_LIST_STALE_MS,
  })
}

/**
 * 화면이 쓰는 최근 한 달: 이 로그인에서 받은 것(받은 시각과 함께), 없으면 기기의 사본. 사본을 읽는 중이면 없고(undefined),
 * 어디에도 없으면 null이다.
 */
export function useKeptLastMonth({ fetch = true } = {}): Kept<LastMonth> | null | undefined {
  const ledger = useCurrentLedger()
  const server = useLastMonthQuery(fetch)
  const receivedAt = useReceivedAt(lastMonthKey(ledger.id))
  const copy = useKeptCopy(ledger.id, 'transactions', parseLastMonth)
  if (server.data && receivedAt !== undefined) return { value: server.data, receivedAt }
  return copy
}
