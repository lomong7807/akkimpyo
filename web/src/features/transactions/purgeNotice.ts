const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 휴지통에 있는 거래의 안내 띠 문구(화면설계서 02 D-06 상태). 남은 날은 서버가 준 영구 삭제 예정 시각(purgeAt)까지를
 * 일 단위로 올려 센다. 기기의 시간대나 자정과 상관없이 두 시각의 차이로 센다(ledger·planner 결정 2026-11-26).
 * 0초가 남았거나 지났으면 날 수 대신 "곧"이다. 두 문장이라 마침표를 찍는다(00-common 3.1).
 */
export function purgeNoticeOf(purgeAt: string, now: number): string {
  const days = Math.ceil((Date.parse(purgeAt) - now) / DAY_MS)
  return days > 0 ? `삭제한 거래예요. ${days}일 뒤 영구 삭제돼요.` : '삭제한 거래예요. 곧 영구 삭제돼요.'
}
