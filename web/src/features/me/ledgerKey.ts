/**
 * 장부 하나에 속한 서버 데이터 캐시 키의 앞부분. 이것을 무효로 만들면 그 장부의 것을 모두 다시 받는다.
 * 잔액, 거래, 통계가 함께 바뀌는 저장(거래 저장 등)은 자원을 하나씩 적지 않고 이것을 무효로 만든다.
 */
export function ledgerScope(ledgerId: string) {
  return ['ledgers', ledgerId] as const
}

/** 장부에 속한 서버 데이터의 캐시 키. 자원의 이름은 그 자원을 받는 기능이 정한다. */
export function ledgerKey(ledgerId: string, resource: string) {
  return [...ledgerScope(ledgerId), resource] as const
}
