/**
 * 목록 화면에서 열었다는 표시. 넓은 화면에서는 입력을 목록 옆 오른쪽 칸에 연다(00-common 5.5).
 * 계좌는 저장한 뒤 새 목록을 쌓지 않고 그 목록으로 돌아간다.
 */
export const openedFromList = { openedFromList: true }

export function isOpenedFromList(state: unknown): boolean {
  return (state as Partial<typeof openedFromList> | null)?.openedFromList === true
}
