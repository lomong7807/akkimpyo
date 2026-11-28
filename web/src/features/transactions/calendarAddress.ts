import { isDate } from '../../lib/calendarDate'

/*
 * 달력(D-02)의 주소와 방문 기록의 상태. 주소에는 달만 담는다(00-common 12.2). 고른 날과 달력을 연 내역 항목은 그 방문 기록
 * 항목의 상태(history state)에 둔다(designer #300 Q5, architect #300). 다른 계정에 보여도 드러나는 것이 없는 화면 상태만 둔다.
 */

export function calendarAddressOf(month: string): string {
  return `/transactions/calendar?month=${month}`
}

/** 달력 항목의 상태 */
export interface CalendarState {
  /** 달력을 연 내역 항목의 표시(listMemory.listKeyOf). 달력에서 옮긴 달을 그 내역에 넘긴다(listMemory.handOffMonth) */
  listKey?: string
  /** 고른 날 `YYYY-MM-DD`. 쓰기 전에 그 달의 고를 수 있는 날인지 다시 본다 */
  day?: string
}

/** 방문 기록의 상태에서 달력의 것만 모양을 보고 꺼낸다. 다른 모양은 없는 것으로 본다. */
export function calendarStateOf(state: unknown): CalendarState {
  if (typeof state !== 'object' || state === null) return {}
  const { listKey, day } = state as Record<string, unknown>
  return {
    ...(typeof listKey === 'string' && listKey !== '' && { listKey }),
    ...(typeof day === 'string' && isDate(day) && { day }),
  }
}
