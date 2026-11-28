/*
 * 시각의 글자(화면설계서 00-common 5.8). 24시간제 `HH:mm`이고 1분 단위다. 시간대는 없다.
 * 시각 칸에서 치는 글자를 다루는 것은 timeInput.ts에 있다. 홈은 그것을 쓰지 않아 첫 화면 JS에 들지 않게 나눈다(#355).
 */

import { formatDate } from './calendarDate'
import { wallTimeNow, wallTimeOf } from './clock'

/** 00:00부터 23:59까지의 `HH:mm`인지 */
export function isValidTime(text: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(text)
}

/**
 * 기기에 적은 시각(밀리초)을 화면의 글자로(00-common 3.2). 기기의 시간대로 본 오늘이면 시각만("10:42"), 아니면 날짜와 시각
 * ("11월 19일 (목) 22:10")이다. 마지막으로 맞춘 시각과 "{시각} 기준"(F-908)이 쓴다.
 */
export function momentText(at: number): string {
  const { date, time } = wallTimeOf(at)
  const today = wallTimeNow().date
  return date === today ? time : `${formatDate(date, today)} ${time}`
}

/** 연결이 없을 때 잔액과 합계 옆에 붙이는 기준 시각("10:42 기준", 00-common 3.2, F-908) */
export function basisText(at: number): string {
  return `${momentText(at)} 기준`
}
