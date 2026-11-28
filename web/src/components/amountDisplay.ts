/** 금액의 종류. 색과 부호는 종류로만 정한다(Amount). */
export type AmountKind = 'expense' | 'income' | 'transfer' | 'balance' | 'difference'

const digits = new Intl.NumberFormat('ko-KR')

/**
 * 원 단위 금액이 화면에 보이는 글자(Amount). 화면 읽기 이름에 금액을 넣을 때도 쓴다(계좌 줄 링크 등, #243).
 * 금액 칸의 글자(lib/amountText)와는 다르다. 그것은 칸을 쓰는 화면만 싣는다.
 */
export function amountText(kind: AmountKind, value: number): string {
  return `${signOf(kind, value)}${digits.format(Math.abs(value))}원`
}

/**
 * 수입·지출 합계의 종류(00-common 2.2). 값 자체가 음수인 합계(환불이 더 큰 날·달, #390)는 잔액처럼 "-"와 본문 글자색이고,
 * 0원인 수입은 부호와 강조색이 없다.
 */
export function totalKind(type: 'income' | 'expense', value: number): 'income' | 'expense' | 'balance' {
  if (type === 'income') return value > 0 ? 'income' : 'balance'
  return value < 0 ? 'balance' : 'expense'
}

/**
 * 거래의 부호는 유형이 정한다. 값의 부호를 보이는 것은 잔액과 합계, 차액뿐이다.
 * 차액은 양수에도 "+"를 붙인다(화면설계서 01 작성자 판단 37). 0원은 부호가 없다.
 */
function signOf(kind: AmountKind, value: number): string {
  if (kind === 'income') return '+'
  if (kind === 'difference' && value > 0) return '+'
  return (kind === 'balance' || kind === 'difference') && value < 0 ? '-' : ''
}
