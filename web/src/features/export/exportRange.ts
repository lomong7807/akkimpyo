import { formatDate, selectableRange } from '../../lib/calendarDate'

/* K-01 (2)·(3)의 기간(F-701, P-202). 날짜는 `YYYY-MM-DD`이고 오늘은 기기의 오늘이다(lib/calendarDate의 today). */

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
 * "전체"로 보내는 기간. 날짜 칸이 고를 수 있는 범위 전체(2000년 1월 1일부터 오늘로부터 1년 뒤까지)라 장부의 모든 거래가 든다.
 * API는 기간을 늘 받고 받은 기간으로 파일 이름을 짓는다(#57). 첫·마지막 거래일로 짓는 것은 서버 후속 #379다.
 */
export function wholeRange(today: string): ExportRange {
  const { first, last } = selectableRange(today)
  return { from: first, to: last }
}

/** 비었는지, 앞뒤가 맞는지(00-common 5.8). 시작일이 종료일보다 늦으면 종료일 칸의 오류다. */
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
