import { lengthOf, normalizeName, TRIMMED_SPACES, trimSpaces } from './visibleText'

/*
 * 한 줄 입력의 해석(F-210, 화면설계서 D-05 "한 줄 해석 규칙"). 기기에서 하므로 연결이 없어도 된다.
 * 금액은 글자에서 자리를 옮겨 정수로 만든다. 부동소수점을 쓰지 않는다.
 */

/** 한 줄 글과 가맹점/내용의 최대 글자 수(F-210, P-214) */
export const ONE_LINE_MAX = 100

/** P-201의 금액 범위 */
const AMOUNT_MAX = 9_999_999_999

export interface OneLine {
  /** 원 단위 정수, 1~9,999,999,999 */
  amount: number
  /** 금액 조각을 뺀 나머지. 없으면 빈 글자다 */
  payee: string
}

/** 해석하기 전에 막는 글: 비었거나 100자를 넘는다. 서버처럼 앞뒤 공백을 지우고 조합형으로 맞춰 센다 */
export function oneLineProblem(text: string): 'empty' | 'too-long' | undefined {
  const length = lengthOf(normalizeName(text))
  if (length === 0) return 'empty'
  if (length > ONE_LINE_MAX) return 'too-long'
}

// 쉼표는 세 자리마다만 받는다(12,000). 아무 데나 둔 쉼표(12,00)는 다른 금액을 뜻했을 수 있다
const number = '(\\d{1,3}(?:,\\d{3})+|\\d+)'
const decimal = `${number}(?:\\.(\\d+))?`
const plainAmount = new RegExp(`^${number}원?$`)
const unitAmount = new RegExp(`^(?:${decimal}만)?(?:${decimal}천)?${number}?원?$`)
const spaces = new RegExp(`[${TRIMMED_SPACES}]+`)

/**
 * 금액 조각이면 그 금액(범위는 보지 않는다), 아니면 없다. 숫자(쉼표 허용), 끝의 "원", 만·천 단위(1만2천, 3.5만, 2천, 1만5000).
 * 만·천 앞의 수는 소수점을 받되 계산한 결과가 정수일 때만 금액이다.
 */
function amountOf(token: string): number | undefined {
  const plain = plainAmount.exec(token)
  if (plain) return Number(digits(plain[1]))
  const unit = unitAmount.exec(token)
  // 만이나 천이 하나는 있어야 한다. 없으면 위의 숫자 모양에서 이미 걸렀다
  if (!unit || (unit[1] === undefined && unit[3] === undefined)) return undefined
  const [, tenThousands, tenThousandsFraction, thousands, thousandsFraction, rest] = unit
  const parts = [scaled(tenThousands, tenThousandsFraction, 4), scaled(thousands, thousandsFraction, 3), scaled(rest, undefined, 0)]
  if (parts.includes(undefined)) return undefined
  return parts.reduce<number>((sum, part) => sum + part!, 0)
}

/** "3.5"에 10의 `power`제곱을 곱한 정수. 정수가 아니면 없고, 수가 없으면 0이다 */
function scaled(whole: string | undefined, fraction = '', power: number): number | undefined {
  if (whole === undefined) return 0
  const kept = fraction.slice(0, power)
  if (/[^0]/.test(fraction.slice(power))) return undefined
  return Number(digits(whole) + kept.padEnd(power, '0'))
}

function digits(text: string): string {
  return text.replaceAll(',', '')
}

/** 글자 수(코드포인트)로 앞에서 자른다 */
function firstCharacters(text: string, count: number): string {
  return [...text].slice(0, count).join('')
}

/**
 * 한 줄 글을 금액과 가맹점/내용으로 나눈다. 공백으로 조각을 나누고 마지막 금액 조각을 금액으로 본다. 나머지 조각은 공백 하나로
 * 이어 가맹점/내용이 되고 100자를 넘으면 자른다. 금액 조각이 없거나 마지막 금액 조각이 1원~9,999,999,999원 밖이면 없다(실패).
 */
export function parseOneLine(text: string): OneLine | undefined {
  const tokens = text.normalize('NFC').split(spaces).filter((token) => token !== '')
  const amounts = tokens.map(amountOf)
  const index = amounts.findLastIndex((amount) => amount !== undefined)
  const amount = amounts[index]
  if (amount === undefined || amount < 1 || amount > AMOUNT_MAX) return undefined
  const rest = tokens.filter((_, i) => i !== index).join(' ')
  return { amount, payee: trimSpaces(firstCharacters(rest, ONE_LINE_MAX)) }
}

/** "자세히 입력"이 가맹점/내용에 채우는 글: 글 전체를 앞뒤 공백만 지우고 100자까지(F-210) */
export function detailPayeeOf(text: string): string {
  return firstCharacters(normalizeName(text), ONE_LINE_MAX)
}
