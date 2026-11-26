/**
 * 장부에서 거래를 만들고 고칠 수 있는 권한인지(P-301): 소유자(OWNER)와 편집 가능(MEMBER). 보기 전용(VIEWER, 2단계)과
 * 서버가 앞으로 더할 모르는 권한은 쓸 수 없는 것으로 본다. 화면의 버튼을 숨기는 데만 쓰고, 막는 것은 서버다.
 */
export function canWriteTransactions(role: string): boolean {
  return role === 'OWNER' || role === 'MEMBER'
}
