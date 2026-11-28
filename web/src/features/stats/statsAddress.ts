/*
 * 통계 화면의 주소(00-common 12.2). 홈(C-01 (2))이 첫 화면 JS에서 쓰므로 화면 코드(MonthlyStatsPage)와 파일을 나눈다(#355).
 */

/** 월별 통계(E-01)의 그 달 */
export function monthlyStatsAddressOf(month: string): string {
  return `/stats/monthly?month=${month}`
}
