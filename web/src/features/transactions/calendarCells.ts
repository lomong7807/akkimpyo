import { monthOf } from '../../lib/calendarDate'
import type { IncomeAndExpense } from './transactions'

/* 달력(D-02)의 날짜 칸에 쓰는 값. 화면 코드에만 들어간다(첫 화면 묶음의 틀은 lib/calendarDate만 쓴다). */

const digits = new Intl.NumberFormat('ko-KR')

/** 휴대폰 배치의 칸에서 만 단위로 줄이기 시작하는 금액 */
const ABBREVIATE_FROM = 1_000_000

/**
 * 날짜 칸의 금액 글자(D-02 (3), 00-common 3.2의 예외). "원"을 붙이지 않는다. 휴대폰 배치는 칸이 좁아 999,999 이하는 쉼표 숫자,
 * 100만 이상은 만 단위 내림("320만")이다. 넓은 화면은 줄이지 않는다(designer #300 Q9). 음수(환불이 더 큰 날, #390)는 절댓값으로
 * 줄이고 금액(Amount)과 같은 "-"를 앞에 붙인다("-320만", designer #390). 수입의 "+"는 부르는 쪽이 붙인다.
 */
export function cellAmount(value: number, wide: boolean): string {
  const size = Math.abs(value)
  const text = wide || size < ABBREVIATE_FROM ? digits.format(size) : `${digits.format(Math.floor(size / 10_000))}만`
  return value < 0 ? `-${text}` : text
}

/**
 * 날짜 칸의 접근 이름: "11월 18일, 지출 16,500원, 수입 0원". 0원도 읽는다. 다른 해의 날은 연도를 붙인다(00-common 3.2).
 * 거래가 없는 날은 `totals`가 없다.
 */
export function cellLabel(date: string, today: string, totals: IncomeAndExpense | undefined): string {
  const [year, month, day] = date.split('-').map(Number)
  const name = date.slice(0, 4) === today.slice(0, 4) ? `${month}월 ${day}일` : `${year}년 ${month}월 ${day}일`
  const { income, expense } = totals ?? { income: 0, expense: 0 }
  return `${name}, 지출 ${digits.format(expense)}원, 수입 ${digits.format(income)}원`
}

/** 처음 고른 날(D-02 (2)): 이번 달이면 오늘, 다른 달이면 1일 */
export function firstDayOf(month: string, today: string): string {
  return monthOf(today) === month ? today : `${month}-01`
}
