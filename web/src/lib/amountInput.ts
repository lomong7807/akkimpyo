/* 금액 칸에서 치고 붙여넣는 글자(화면설계서 00-common 5.3). 보이는 글자는 amountText.ts에 있다(#355에서 나눔). */

/** 부호를 뺀 최대(P-201)의 자릿수 */
const MAX_DIGITS = 10

/** 전각 숫자와 다른 글자의 숫자는 숫자로 보지 않는다. */
export function digitsOf(text: string): string {
  return text.replace(/[^0-9]/g, '')
}

/**
 * 붙여넣은 글에서 넣을 숫자. 끝이 점과 숫자 한두 자리이면(그 뒤의 공백과 "원" 같은 글자는 보지 않는다) 원 아래의 자리로 보고
 * 버린다. 점 뒤가 세 자리면 자릿수를 나눈 점이다. 손으로 치는 점은 그냥 들어가지 않는다(planner 결정 2026-11-26).
 */
export function pastedDigits(text: string): string {
  return digitsOf(text.replace(/\.[0-9]{1,2}[^0-9]*$/, ''))
}

/**
 * 커서 앞과 뒤의 글자에서 숫자만 골라 잇고 앞자리 0을 지운다.
 * 커서 앞에 남은 숫자의 수를 함께 준다. 최대 자릿수를 넘으면 없다.
 */
export function joinDigits(before: string, after: string): { value: number | undefined; caret: number } | undefined {
  const leading = digitsOf(before)
  const all = leading + digitsOf(after)
  const digits = all.replace(/^0+(?=[0-9])/, '')
  if (digits.length > MAX_DIGITS) return undefined
  return {
    value: digits === '' ? undefined : Number(digits),
    caret: Math.max(0, leading.length - (all.length - digits.length)),
  }
}

/** 보이는 글자에서 숫자 `count`개 바로 뒤의 자리. 0개면 부호 뒤다. */
export function positionAfterDigits(text: string, count: number): number {
  let position = text.startsWith('-') ? 1 : 0
  for (let passed = 0; passed < count; position += 1) {
    if (text[position] !== ',') passed += 1
  }
  return position
}
