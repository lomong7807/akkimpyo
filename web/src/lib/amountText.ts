/*
 * 금액 칸의 글자와 값(화면설계서 00-common 5.3). 보이는 것은 쉼표를 넣은 글자이고 저장하는 것은 원 단위 정수다.
 * 금액 칸에서 치고 붙여넣는 글자를 다루는 것은 amountInput.ts에 있다. 홈은 그것을 쓰지 않아 첫 화면 JS에 들지 않게 나눈다(#355).
 */

/** 칸에 보이는 글자. 비었으면 부호만 남는다. */
export function formatAmount(value: number | undefined, negative: boolean): string {
  const digits = value === undefined ? '' : String(value).replace(/\B(?=([0-9]{3})+$)/g, ',')
  return negative ? `-${digits}` : digits
}
