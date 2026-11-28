import { monthOf } from '../../lib/calendarDate'
import type { LastMonth } from './lastMonth'
import type { DayTotal, IncomeAndExpense, ListedTransaction } from './transactions'

/* 기기의 최근 한 달(#238)에서 한 달을 고른다. 내역만 쓰므로 첫 화면 JS에 들지 않게 lastMonth.ts와 나눠 둔다(#355). */

/** 기기의 최근 한 달 가운데 한 달 */
export interface KeptMonth {
  totals: IncomeAndExpense
  items: ListedTransaction[]
  days: DayTotal[]
  /** 그 달의 앞쪽 일부가 저장 범위 밖이다(목록 끝에 "연결되면 볼 수 있어요", D-01) */
  partial: boolean
}

/** 저장 범위가 그 달에 걸치면 그 달의 합계와 거래. 걸치지 않으면(저장 범위 밖의 달) 없다. */
export function keptMonthOf(kept: LastMonth, month: string): KeptMonth | undefined {
  const totals = kept.months.find((each) => each.month === month)?.totals
  if (!totals) return undefined
  return {
    totals,
    items: kept.items.filter(({ occurredOn }) => monthOf(occurredOn) === month),
    days: kept.days.filter(({ date }) => monthOf(date) === month),
    partial: `${month}-01` < kept.from,
  }
}
