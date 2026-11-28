import type { SuggestionState } from './categorySuggestion'
import type { TransactionValues } from './transactionForm'

/*
 * 한 줄 입력(C-01 (1), D-05)과 거래 입력(D-04) 사이에 넘기는 값(#233). 사용자가 쓴 글과 칸 값은 방문 기록(history state)에
 * 넣지 않고 이 탭의 메모리에 사용자·장부와 함께 둔다. 방문 기록에는 여는 때 만든 표시만 둔다(architect #233 5, security #233).
 * 새로고침하면 비어 빈 새 입력으로 연다. 로그인이 끝나면(로그아웃, 풀림) 비운다(SignedInArea).
 */

interface Owner {
  userId: string | undefined
  ledgerId: string
}

/** 거래 입력을 채울 값. 해석 실패의 "자세히 입력"은 가맹점/내용만, D-05의 "자세히"는 칸 값 전부다 */
export interface EntryHandoff {
  /** 한 줄 입력칸에 쓴 글. 거래 입력을 떠나면 입력칸에 되돌린다 */
  text: string
  values: Partial<TransactionValues>
  /** D-05의 카테고리 제안 상태. 거래 입력에서도 도움말을 잇고, 직접 고른 카테고리를 덮어쓰지 않는다(P-502) */
  suggestion?: SuggestionState
}

let toEntry: (EntryHandoff & Owner & { mark: string }) | undefined
let toHome: (Owner & { text: string }) | undefined

/** 방문 기록에 두는 표시. 이 탭에서 만든 임의 글자이고 값을 담지 않는다 */
export function newMark(): string {
  return Math.random().toString(36).slice(2)
}

function sameOwner(a: Owner, b: Owner): boolean {
  return a.userId !== undefined && a.userId === b.userId && a.ledgerId === b.ledgerId
}

/** 거래 입력을 열 때 넘길 값을 두고, 그 주소의 방문 기록에 둘 표시를 돌려준다 */
export function handOffToEntry(owner: Owner, handoff: EntryHandoff): { oneLineEntry: string } {
  const mark = newMark()
  toEntry = { ...handoff, ...owner, mark }
  return { oneLineEntry: mark }
}

/** 거래 입력이 받을 값. 표시와 사용자·장부가 지금과 같을 때만 있다 */
export function entryHandoffOf(state: unknown, owner: Owner): EntryHandoff | undefined {
  const mark = (state as { oneLineEntry?: unknown } | null)?.oneLineEntry
  if (!toEntry || mark !== toEntry.mark || !sameOwner(toEntry, owner)) return undefined
  return { text: toEntry.text, values: toEntry.values, suggestion: toEntry.suggestion }
}

/** 홈으로 돌아가면 한 줄 입력칸에 둘 글. 저장했으면 빈 글자다(D-04 성공 뒤 표) */
export function returnToOneLine(owner: Owner, text: string): void {
  toHome = { ...owner, text }
}

/** 홈이 그릴 때 읽는 글. 읽어도 지우지 않는다(StrictMode의 두 번 그리기). 쓴 뒤에 settleOneLineReturn으로 지운다 */
export function oneLineReturnOf(owner: Owner): string | undefined {
  return toHome && sameOwner(toHome, owner) ? toHome.text : undefined
}

/** 읽은 글을 썼다. 그 뒤에 새로 적힌 것은 남긴다 */
export function settleOneLineReturn(text: string): void {
  if (toHome?.text === text) toHome = undefined
}

/** 로그인이 끝났다. 앞 사용자의 글과 값을 남기지 않는다 */
export function forgetOneLineHandoff(): void {
  toEntry = undefined
  toHome = undefined
}
