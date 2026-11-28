import { formatDate, selectableRange } from '../../lib/calendarDate'

/*
 * K-01 (3)의 기간(F-701, P-202). 날짜는 `YYYY-MM-DD`이고 오늘은 기기의 오늘이다(lib/calendarDate의 today).
 * (2)의 "전체"는 기간을 보내지 않는다(exportFile의 range, #393).
 */

/** 시작일과 종료일(둘 다 포함). 고르지 않은 날은 빈 글자다 */
export interface ExportRange {
  from: string
  to: string
}

/** 칸마다의 오류 문구. 맞으면 그 칸이 없다 */
export type RangeErrors = Partial<Record<keyof ExportRange, string>>

export const START_REQUIRED = '시작일을 골라 주세요'
export const END_REQUIRED = '종료일을 골라 주세요'
export const END_BEFORE_START = '종료일은 시작일과 같거나 뒤여야 해요'

/** "기간 정하기"의 기본값: 올해 1월 1일부터 오늘까지(K-01 (3), 작성자 판단 28) */
export function defaultRange(today: string): ExportRange {
  return { from: `${today.slice(0, 4)}-01-01`, to: today }
}

/**
 * 비었는지, 앞뒤가 맞는지(00-common 5.8). 시작일이 종료일보다 늦으면 종료일 칸의 오류다. 하나만 빈 기간은 서버가 400 REQUIRED로
 * 거부하므로(#379) 보내기 전에 여기서 막는다. 서버의 REQUIRED도 같은 문구다(ExportPage의 rejectedFields).
 */
export function checkRange({ from, to }: ExportRange): RangeErrors {
  const errors: RangeErrors = {}
  if (from === '') errors.from = START_REQUIRED
  if (to === '') errors.to = END_REQUIRED
  if (from !== '' && to !== '' && from > to) errors.to = END_BEFORE_START
  return errors
}

/** 날짜 칸이 범위 밖 날짜를 막으므로 서버가 거부한 때에만 나온다(00-common 4.4) */
export function outOfRangeText(today: string): string {
  const { first, last } = selectableRange(today)
  return `${formatDate(first, today)}부터 ${formatDate(last, today)}까지 고를 수 있어요`
}
