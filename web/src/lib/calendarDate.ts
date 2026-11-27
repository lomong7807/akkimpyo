/*
 * 날짜는 시간대가 없는 `YYYY-MM-DD` 글자, 달은 `YYYY-MM` 글자다. 앞뒤는 글자 순서로 비교한다.
 * 계산할 때만 UTC 자정의 Date로 바꾼다. 기기의 시간대를 쓰는 곳은 오늘을 읽는 `today`뿐이고, 지금과 시간대는 clock에서 읽는다.
 */

import { wallTimeNow } from './clock'

export interface DateRange {
  first: string
  last: string
}

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const WEEKS_SHOWN = 6

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function partsOf(date: string): number[] {
  return date.split('-').map(Number)
}

function dateOf(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function weekdayOf(date: string): number {
  const [year, month, day] = partsOf(date)
  return utc(year, month, day).getUTCDay()
}

/** 기기의 오늘 */
export function today(): string {
  return wallTimeNow().date
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** `YYYY-MM` 모양의 있는 달인지 */
export function isMonth(text: string): boolean {
  return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(text)
}

/** `YYYY-MM-DD` 모양의 있는 날짜인지. 2월 30일처럼 없는 날은 아니다. */
export function isDate(text: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text) && addDays(text, 0) === text
}

/** 달을 `months`달 옮긴다. */
export function moveMonth(month: string, months: number): string {
  return monthOf(addMonths(`${month}-01`, months))
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = partsOf(date)
  return dateOf(utc(year, month, day + days))
}

/** 옮긴 달에 없는 날이면 그 달의 마지막 날이다. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = partsOf(date)
  const lastDay = utc(year, month + months + 1, 0).getUTCDate()
  return dateOf(utc(year, month + months, Math.min(day, lastDay)))
}

export function startOfWeek(date: string): string {
  return addDays(date, -weekdayOf(date))
}

export function endOfWeek(date: string): string {
  return addDays(startOfWeek(date), 6)
}

/** 날짜 칸에서 고를 수 있는 범위(P-202, F-204) */
export function selectableRange(today: string): DateRange {
  return { first: '2000-01-01', last: addMonths(today, 12) }
}

/** 달 이동에서 고를 수 있는 달(화면설계서 00-common 5.9). 날짜 칸의 범위가 걸친 달이다. */
export function selectableMonths(today: string): DateRange {
  const { first, last } = selectableRange(today)
  return { first: monthOf(first), last: monthOf(last) }
}

export function clampDate(date: string, { first, last }: DateRange): string {
  if (date < first) return first
  return date > last ? last : date
}

/** 한 달을 일요일부터 여섯 줄로 나눈다. 다른 달의 자리는 비운다. */
export function weeksOf(month: string): (string | undefined)[][] {
  const start = startOfWeek(`${month}-01`)
  return Array.from({ length: WEEKS_SHOWN }, (_, week) =>
    WEEKDAYS.map((_, weekday) => {
      const date = addDays(start, week * WEEKDAYS.length + weekday)
      return monthOf(date) === month ? date : undefined
    }),
  )
}

/** 그 달의 주 수만큼의 줄(달력 D-02 (2)). 일요일부터이고 다른 달의 자리는 비운다. 날짜 고르기(5.8)는 늘 6줄(weeksOf)이다 */
export function monthWeeks(month: string): (string | undefined)[][] {
  return weeksOf(month).filter((week) => week.some((date) => date !== undefined))
}

/** 고를 수 있는 달(00-common 5.9)인지. 달 모양이 아니거나 범위 밖이면 아니다 */
export function isSelectableMonth(month: string | null, { first, last }: DateRange): month is string {
  return month !== null && isMonth(month) && month >= first && month <= last
}

/** 화면에 쓰는 날짜(화면설계서 00-common 3.2) */
export function formatDate(date: string, today: string): string {
  const [year, month, day] = partsOf(date)
  const monthAndDay = `${month}월 ${day}일`
  return isSameYear(date, today) ? `${monthAndDay} (${WEEKDAYS[weekdayOf(date)]})` : `${year}년 ${monthAndDay}`
}

/** 화면에 쓰는 달(화면설계서 00-common 3.2) */
export function formatMonth(month: string, today: string): string {
  const [year, monthNumber] = partsOf(month)
  return isSameYear(month, today) ? `${monthNumber}월` : `${year}년 ${monthNumber}월`
}

/** 화면 낭독기가 읽는 날짜 전체 */
export function fullDate(date: string): string {
  const [year, month, day] = partsOf(date)
  return `${year}년 ${month}월 ${day}일 ${WEEKDAYS[weekdayOf(date)]}요일`
}

function isSameYear(dateOrMonth: string, today: string): boolean {
  return dateOrMonth.slice(0, 4) === today.slice(0, 4)
}
