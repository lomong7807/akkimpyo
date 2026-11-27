/**
 * 장부 하나에 속한 서버 데이터 캐시 키의 앞부분. 이것을 무효로 만들면 그 장부의 것을 모두 다시 받는다.
 * 잔액, 거래, 통계가 함께 바뀌는 저장(거래 저장 등)은 자원을 하나씩 적지 않고 이것을 무효로 만든다.
 */
export function ledgerScope(ledgerId: string) {
  return ['ledgers', ledgerId] as const
}

/**
 * 장부 경로의 목록 API를 받는 조회에 붙이는 표시(TanStack Query의 meta). 이 조회가 404이면 그 장부를 볼 수 없게 된 것이라
 * 그 장부의 기기 사본을 지운다(security Q4, #234). 거래 상세처럼 그 자원만 없을 수 있는 조회에는 붙이지 않는다.
 */
export const LEDGER_LIST = { ledgerList: true } as const

/** 장부에 속한 서버 데이터의 캐시 키. 자원의 이름은 그 자원을 받는 기능이 정한다. */
export function ledgerKey(ledgerId: string, resource: string) {
  return [...ledgerScope(ledgerId), resource] as const
}
