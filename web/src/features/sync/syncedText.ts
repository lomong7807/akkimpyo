import { formatDate } from '../../lib/calendarDate'
import { wallTimeNow, wallTimeOf } from '../../lib/clock'

/** 한 번도 맞추지 못했을 때(B-04 (2-3)) */
export const NEVER_SYNCED = '아직 맞추지 않았어요'

/**
 * 마지막으로 맞춘 시각의 글자(B-04 (2-3), M-01 (16), 00-common 3.2). 기기의 시간대로 본 오늘이면 시각만("10:42에 맞춤"), 아니면
 * 날짜와 시각("11월 19일 (목) 22:10에 맞춤")이다. 한 번도 맞추지 못했으면 NEVER_SYNCED다.
 */
export function syncedText(at: number | undefined): string {
  return at === undefined ? NEVER_SYNCED : `${syncedMoment(at)}에 맞춤`
}

/**
 * 맞춘 시각(00-common 3.2). 기기의 시간대로 본 오늘이면 시각만("10:42"), 아니면 날짜와 시각("11월 19일 (목) 22:10")이다.
 * B-04 (2-3)과 보내지 않은 입력 목록(B-05 (1))이 쓴다.
 */
export function syncedMoment(at: number): string {
  const { date, time } = wallTimeOf(at)
  const today = wallTimeNow().date
  return date === today ? time : `${formatDate(date, today)} ${time}`
}
