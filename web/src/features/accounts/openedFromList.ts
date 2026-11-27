/** 계좌 목록에서 열었다는 표시. 저장한 뒤 새 목록을 쌓지 않고 그 목록으로 돌아간다. */
export const openedFromList = { openedFromList: true }

export function isOpenedFromList(state: unknown): boolean {
  return (state as Partial<typeof openedFromList> | null)?.openedFromList === true
}
