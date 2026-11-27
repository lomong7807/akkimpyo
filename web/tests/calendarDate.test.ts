import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addDays,
  addMonths,
  clampDate,
  endOfWeek,
  formatDate,
  formatMonth,
  fullDate,
  isDate,
  isMonth,
  monthOf,
  moveMonth,
  selectableMonths,
  selectableRange,
  startOfWeek,
  today,
  weeksOf,
} from '../src/lib/calendarDate'
import { setDeviceClock } from './support/clock'

afterEach(() => {
  vi.unstubAllEnvs()
})

// 날짜 값에는 시간대가 없다. 기기가 어느 시간대에 있어도 같은 값이 나와야 한다.
// 이 계산은 기기의 시간대를 읽지 않아야 하므로 Date의 지역 시각이 쓰는 시간대(TZ)를 바꿔 본다. 결과는 바깥의 TZ와 상관없다.
describe.each(['Asia/Seoul', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'])('기기의 시간대가 %s일 때', (timeZone) => {
  beforeEach(() => vi.stubEnv('TZ', timeZone))

  it('시간대가 실제로 바뀐다', () => {
    const hour = new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(0)
    expect(new Date(0).getHours()).toBe(Number(hour))
  })

  it.each([
    ['2026-11-26', 1, '2026-11-27'],
    ['2026-11-26', -1, '2026-11-25'],
    ['2026-11-26', 7, '2026-12-03'],
    ['2026-11-30', 1, '2026-12-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2028-02-29', 1, '2028-03-01'],
    ['2026-02-28', 1, '2026-03-01'],
    // 로스앤젤레스의 여름 시간이 시작하고 끝나는 날
    ['2026-03-08', 1, '2026-03-09'],
    ['2026-11-01', 1, '2026-11-02'],
    ['2026-11-02', -1, '2026-11-01'],
  ])('%s에서 %d일 옮기면 %s이다', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected)
  })

  it.each([
    ['2026-11-26', 1, '2026-12-26'],
    ['2026-12-26', 1, '2027-01-26'],
    ['2026-01-26', -1, '2025-12-26'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-10-31', 1, '2026-11-30'],
    ['2026-12-31', -1, '2026-11-30'],
    ['2028-02-29', 12, '2029-02-28'],
    ['2027-02-28', 12, '2028-02-28'],
    ['2100-01-31', 1, '2100-02-28'],
    ['2000-01-31', 1, '2000-02-29'],
  ])('%s에서 %d달 옮기면 %s이다(없는 날은 그 달의 마지막 날)', (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected)
  })

  it.each([
    ['2026-11-26', '2026-11-22', '2026-11-28'],
    ['2026-11-22', '2026-11-22', '2026-11-28'],
    ['2026-11-28', '2026-11-22', '2026-11-28'],
    ['2026-12-01', '2026-11-29', '2026-12-05'],
    ['2027-01-01', '2026-12-27', '2027-01-02'],
  ])('%s이 속한 주는 일요일 %s부터 토요일 %s까지다', (date, start, end) => {
    expect(startOfWeek(date)).toBe(start)
    expect(endOfWeek(date)).toBe(end)
  })

  it.each([
    ['2026-11-26', '2027-11-26'],
    ['2026-12-31', '2027-12-31'],
    ['2028-02-29', '2029-02-28'],
    ['2027-02-28', '2028-02-28'],
    ['2027-03-01', '2028-03-01'],
  ])('오늘이 %s이면 2000-01-01부터 %s까지 고를 수 있다', (day, last) => {
    expect(selectableRange(day)).toEqual({ first: '2000-01-01', last })
  })

  it.each([
    ['1999-12-31', '2000-01-01'],
    ['2000-01-01', '2000-01-01'],
    ['2026-11-26', '2026-11-26'],
    ['2027-11-26', '2027-11-26'],
    ['2027-11-27', '2027-11-26'],
  ])('%s을 범위 안으로 당기면 %s이다', (date, expected) => {
    expect(clampDate(date, { first: '2000-01-01', last: '2027-11-26' })).toBe(expected)
  })

  it('한 달을 일요일부터 시작하는 여섯 줄로 나누고 다른 달의 자리는 비운다', () => {
    const weeks = weeksOf('2026-11')
    expect(weeks).toHaveLength(6)
    expect(weeks.every((week) => week.length === 7)).toBe(true)
    expect(weeks[0]).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ])
    expect(weeks[4]).toEqual(['2026-11-29', '2026-11-30', undefined, undefined, undefined, undefined, undefined])
    expect(weeks[5]).toEqual(Array(7).fill(undefined))
  })

  it.each([
    ['2026-02', 0, 28, 4],
    ['2026-08', 6, 31, 6],
    ['2026-05', 5, 31, 6],
    ['2028-02', 2, 29, 5],
    ['2000-01', 6, 31, 6],
    ['2027-01', 5, 31, 6],
    ['2026-12', 2, 31, 5],
  ])('%s은 %d칸을 비우고 %d일까지 %d줄에 놓는다', (month, blanks, days, rows) => {
    const cells = weeksOf(month).flat()
    expect(cells).toHaveLength(42)
    expect(cells.findIndex((date) => date !== undefined)).toBe(blanks)
    expect(cells.filter((date) => date !== undefined)).toEqual(
      Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
    )
    expect(weeksOf(month).filter((week) => week.some((date) => date !== undefined))).toHaveLength(rows)
  })

  it('날짜가 속한 달을 안다', () => {
    expect(monthOf('2026-11-01')).toBe('2026-11')
    expect(monthOf('2026-11-30')).toBe('2026-11')
  })

  it.each([
    ['2026-11', 1, '2026-12'],
    ['2026-12', 1, '2027-01'],
    ['2027-01', -1, '2026-12'],
    ['2000-01', -1, '1999-12'],
    ['2026-11', 12, '2027-11'],
    ['2028-02', 1, '2028-03'],
  ])('%s에서 %d달 옮기면 %s이다', (month, months, expected) => {
    expect(moveMonth(month, months)).toBe(expected)
  })

  it.each([
    ['2026-11-26', '2027-11'],
    ['2026-11-01', '2027-11'],
    ['2026-12-31', '2027-12'],
    ['2027-01-01', '2028-01'],
    ['2028-02-29', '2029-02'],
  ])('오늘이 %s이면 2000-01부터 %s까지 고를 수 있다', (day, last) => {
    expect(selectableMonths(day)).toEqual({ first: '2000-01', last })
  })

  it.each(['2026-11', '2000-01', '2026-01', '2026-12', '9999-12'])('%s은 달이다', (text) => {
    expect(isMonth(text)).toBe(true)
  })

  it.each(['2026-13', '2026-00', '2026-1', '26-11', '2026-11-01', '2026/11', ' 2026-11', '2026-11 ', '', '２０２６-11'])(
    '"%s"은 달이 아니다',
    (text) => {
      expect(isMonth(text)).toBe(false)
    },
  )

  it.each(['2026-11-26', '2028-02-29', '2026-12-31', '2000-01-01'])('%s은 있는 날짜다', (text) => {
    expect(isDate(text)).toBe(true)
  })

  it.each(['2026-02-29', '2026-11-31', '2026-13-01', '2026-11-00', '2026-11-1', '2026-11', '2026-11-26T00:00', ''])(
    '"%s"은 날짜가 아니다',
    (text) => {
      expect(isDate(text)).toBe(false)
    },
  )

  it.each([
    ['2026-11-26', '11월 26일 (목)'],
    ['2026-11-01', '11월 1일 (일)'],
    ['2026-01-01', '1월 1일 (목)'],
    ['2026-12-31', '12월 31일 (목)'],
    ['2025-12-31', '2025년 12월 31일'],
    ['2027-01-01', '2027년 1월 1일'],
    ['2000-01-01', '2000년 1월 1일'],
  ])('올해가 2026년이면 %s을 "%s"로 쓴다', (date, expected) => {
    expect(formatDate(date, '2026-11-26')).toBe(expected)
  })

  it.each([
    ['2026-11', '11월'],
    ['2026-01', '1월'],
    ['2025-12', '2025년 12월'],
    ['2027-01', '2027년 1월'],
  ])('올해가 2026년이면 %s을 "%s"로 쓴다', (month, expected) => {
    expect(formatMonth(month, '2026-11-26')).toBe(expected)
  })

  it.each([
    ['2026-11-26', '2026년 11월 26일 목요일'],
    ['2026-11-01', '2026년 11월 1일 일요일'],
    ['2028-02-29', '2028년 2월 29일 화요일'],
  ])('%s의 전체 이름은 "%s"이다', (date, expected) => {
    expect(fullDate(date)).toBe(expected)
  })
})

describe('기기의 오늘', () => {
  // 같은 순간이라도 기기의 시간대에 따라 날짜가 다르다
  it.each([
    ['Asia/Seoul', '2026-11-25T14:59:59.999Z', '2026-11-25'],
    ['Asia/Seoul', '2026-11-25T15:00:00.000Z', '2026-11-26'],
    ['UTC', '2026-11-25T23:59:59.999Z', '2026-11-25'],
    ['UTC', '2026-11-26T00:00:00.000Z', '2026-11-26'],
    ['America/Los_Angeles', '2026-11-26T07:59:59.999Z', '2026-11-25'],
    ['America/Los_Angeles', '2026-11-26T08:00:00.000Z', '2026-11-26'],
    ['Pacific/Kiritimati', '2026-11-25T09:59:59.999Z', '2026-11-25'],
    ['Pacific/Kiritimati', '2026-11-25T10:00:00.000Z', '2026-11-26'],
    ['Pacific/Pago_Pago', '2026-11-26T10:59:59.999Z', '2026-11-25'],
    ['Pacific/Pago_Pago', '2026-11-26T11:00:00.000Z', '2026-11-26'],
    ['Asia/Seoul', '2026-12-31T15:00:00.000Z', '2027-01-01'],
    ['Asia/Seoul', '2028-02-28T15:00:00.000Z', '2028-02-29'],
  ])('%s에서 %s이면 %s이다', (timeZone, instant, expected) => {
    setDeviceClock(instant, timeZone)
    expect(today()).toBe(expected)
  })
})
