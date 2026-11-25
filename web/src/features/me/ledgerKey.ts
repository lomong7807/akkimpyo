/**
 * 장부에 속한 서버 데이터의 캐시 키. 자원의 이름은 그 자원을 받는 기능이 정한다.
 * 앞부분 ['ledgers', ledgerId]를 무효로 만들면 그 장부의 것을 모두 다시 받는다.
 */
export function ledgerKey(ledgerId: string, resource: string) {
  return ['ledgers', ledgerId, resource] as const
}
