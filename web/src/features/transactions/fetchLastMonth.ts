import type { SenderCheck } from '../../api/request'
import { addDays, monthOf, moveMonth } from '../../lib/calendarDate'
import { KEPT_DAYS, type LastMonth } from './lastMonth'
import { fetchLedgerPage, fetchMonthTotals, type DayTotal, type IncomeAndExpense, type ListedTransaction } from './transactions'

/*
 * 최근 한 달(P-902)을 서버에서 받는 곳은 여기 하나다(#238). 첫 화면 묶음을 늘리지 않으려고 쓸 때 따로 싣는다(architect #238).
 * 서버에 기간 조회가 생기면 이 함수만 바꾼다(ledger 2026-11-27).
 */

/** 한 번에 이어 받는 쪽의 상한(50건씩 20쪽, architect #238 A). 31일 안에 거래가 아주 많은 장부에서 요청이 끝없이 이어지지 않게 한다 */
export const MAX_PAGES = 20

interface FetchOptions {
  /** 주면 쪽마다 같은 사용자의 토큰으로만 보낸다(request의 sender) */
  sender?: SenderCheck
  /** 그 달 합계를 받는 법. 홈의 이번 달 합계와 같은 요청을 두 번 보내지 않도록 캐시를 거쳐 받게 한다. 없으면 바로 받는다 */
  monthTotals?: (month: string) => Promise<IncomeAndExpense>
}

/**
 * 기기의 오늘(`today`)을 포함한 지난 31일의 거래와 그날 합계, 저장 범위가 걸친 달마다 그 달 합계를 받는다.
 * #15의 장부 전체 모드로 날짜 역순으로 50건씩 받다가 31일 밖 날짜가 나오면 멈춘다. 장부 전체 모드는 장부 시간대의 오늘까지만
 * 주고(서버), 기기의 오늘보다 뒤의 날짜는 여기서 뺀다. 그래서 기기와 장부의 오늘이 다른 시간대에서는 하루치가 다를 수 있다
 * (ledger 받아들임). 상한(MAX_PAGES)에서 멈추면 끝까지 받지 못한 마지막 날부터는 저장 범위에서 빼고 `truncated`를 남긴다.
 * 실패하면 ApiError를 던진다(일부만 남기지 않는다).
 */
export async function fetchLastMonth(
  ledgerId: string,
  today: string,
  { sender, monthTotals = (month) => fetchMonthTotals(ledgerId, month, sender) }: FetchOptions = {},
): Promise<LastMonth> {
  let from = addDays(today, 1 - KEPT_DAYS)
  const items: ListedTransaction[] = []
  const days: DayTotal[] = []
  let cursor: string | null = null
  let pages = 0
  let truncated = false
  do {
    const page = await fetchLedgerPage(ledgerId, cursor, sender)
    pages += 1
    items.push(...page.items)
    days.push(...page.days)
    const last = page.items.at(-1)
    // 마지막 거래가 아직 저장 범위 안이면 그날이 다음 쪽에 이어질 수 있다
    cursor = last && last.occurredOn >= from ? page.nextCursor : null
    if (cursor !== null && pages === MAX_PAGES) {
      truncated = true
      from = addDays(last!.occurredOn, 1)
      cursor = null
    }
  } while (cursor !== null)
  const inRange = (date: string) => date >= from && date <= today
  const months = await Promise.all(
    monthsBetween(from, today).map(async (month) => ({ month, totals: await monthTotals(month) })),
  )
  return {
    from,
    to: today,
    items: items.filter(({ occurredOn }) => inRange(occurredOn)),
    // 한 날이 두 쪽에 걸치면 같은 값이 두 번 온다(#15)
    days: [...new Map(days.filter(({ date }) => inRange(date)).map((day) => [day.date, day])).values()],
    months,
    truncated,
  }
}

/** `from`이 속한 달부터 `to`가 속한 달까지. `from`이 `to`보다 뒤면(잘려 하루도 남지 않음) 없다 */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  for (let month = monthOf(from); from <= to && month <= monthOf(to); month = moveMonth(month, 1)) months.push(month)
  return months
}
