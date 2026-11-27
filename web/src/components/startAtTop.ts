/**
 * 다음에 그릴 화면을 앞서 보던 위치가 아니라 맨 위에서 시작하라는 표시(#245, designer 결정 2026-11-26).
 * 저장에 성공해 떠나는 입력 화면이 단다(useLeaveGuard). 새로 저장한 것은 목록 맨 위에 생기므로, 뒤로 가기로 돌아가도
 * 맨 위에서 보여야 한다. 닫기, 취소, 브라우저 뒤로, Esc로 돌아가면 표시가 없어 위치를 지킨다(00-common 4.5).
 * 화면이 바뀌면 한 번 보고 지운다(ScrollPosition). 탭 하나에 화면이 하나뿐이라 모듈에 하나만 둔다.
 */
let pending = false

export function startNextScreenAtTop(): void {
  pending = true
}

/** 표시가 있었는지 돌려주고 지운다. */
export function takeStartAtTop(): boolean {
  const marked = pending
  pending = false
  return marked
}
