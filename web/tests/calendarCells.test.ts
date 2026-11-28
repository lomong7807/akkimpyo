import { describe, expect, it } from 'vitest'
import { cellAmount, cellLabel, firstDayOf } from '../src/features/transactions/calendarCells'
import { monthWeeks } from '../src/lib/calendarDate'

describe('날짜 칸의 금액(D-02 (3), 00-common 3.2의 예외)', () => {
  it.each([
    [1, '1'],
    [16500, '16,500'],
    [999999, '999,999'],
    [1000000, '100만'],
    [1009999, '100만'],
    [3209999, '320만'],
    [12345678, '1,234만'],
  ])('휴대폰 배치: %i원은 "%s"(100만 이상은 만 단위 내림, "원" 없음)', (value, text) => {
    expect(cellAmount(value, false)).toBe(text)
  })

  it.each([
    [999999, '999,999'],
    [1000000, '1,000,000'],
    [1009999, '1,009,999'],
    [3209999, '3,209,999'],
  ])('넓은 화면: %i원은 줄이지 않고 "%s"("원" 없음, designer #300 Q9)', (value, text) => {
    expect(cellAmount(value, true)).toBe(text)
  })

  it.each([
    [-1, false, '-1'],
    [-12000, false, '-12,000'],
    [-999999, false, '-999,999'],
    [-1000000, false, '-100만'],
    [-3209999, false, '-320만'],
    [-3209999, true, '-3,209,999'],
  ])('음수(환불이 더 큰 날, #390) %i원은 절댓값으로 줄이고 "-"를 앞에 붙인다(넓은 화면 %s): "%s"', (value, wide, text) => {
    expect(cellAmount(value, wide)).toBe(text)
  })
})

describe('날짜 칸의 접근 이름(D-02 (3))', () => {
  it('"11월 18일, 지출 16,500원, 수입 0원"처럼 둘 다 읽는다(0원도 읽는다)', () => {
    expect(cellLabel('2026-11-18', '2026-11-26', { income: 0, expense: 16500 })).toBe(
      '11월 18일, 지출 16,500원, 수입 0원',
    )
    expect(cellLabel('2026-11-25', '2026-11-26', { income: 3200000, expense: 20000 })).toBe(
      '11월 25일, 지출 20,000원, 수입 3,200,000원',
    )
  })

  it('음수 합계(#390)는 "-"를 붙여 읽는다', () => {
    expect(cellLabel('2026-11-01', '2026-11-26', { income: -3000, expense: -12000 })).toBe(
      '11월 1일, 지출 -12,000원, 수입 -3,000원',
    )
  })

  it('거래가 없는 날도 0원으로 읽는다', () => {
    expect(cellLabel('2026-11-03', '2026-11-26', undefined)).toBe('11월 3일, 지출 0원, 수입 0원')
  })

  it('다른 해의 날은 연도를 붙인다(00-common 3.2)', () => {
    expect(cellLabel('2025-12-31', '2026-01-01', undefined)).toBe('2025년 12월 31일, 지출 0원, 수입 0원')
  })
})

describe('처음 고른 날(D-02 (2))', () => {
  it('이번 달이면 오늘, 다른 달이면 1일이다', () => {
    expect(firstDayOf('2026-11', '2026-11-26')).toBe('2026-11-26')
    expect(firstDayOf('2026-10', '2026-11-26')).toBe('2026-10-01')
    expect(firstDayOf('2027-11', '2026-11-26')).toBe('2027-11-01')
  })
})

describe('그 달의 주 수만큼 줄(D-02 (2))', () => {
  it.each([
    ['2026-02', 4],
    ['2026-11', 5],
    ['2026-08', 6],
    ['2028-02', 5],
  ])('%s는 %i줄이고 다른 달의 자리는 비운다', (month, weeks) => {
    const rows = monthWeeks(month)
    expect(rows).toHaveLength(weeks)
    expect(rows.every((row) => row.length === 7)).toBe(true)
    const dates = rows.flat().filter((date) => date !== undefined)
    expect(dates.every((date) => date.startsWith(month))).toBe(true)
    expect(dates[0]).toBe(`${month}-01`)
  })

  it('2026년 11월은 일요일 1일부터 30일까지다', () => {
    const rows = monthWeeks('2026-11')
    expect(rows[0][0]).toBe('2026-11-01')
    expect(rows[4][1]).toBe('2026-11-30')
    expect(rows[4].slice(2)).toEqual([undefined, undefined, undefined, undefined, undefined])
  })
})
