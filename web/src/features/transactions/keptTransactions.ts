import { readCopy } from '../../device/copies'
import { TRIMMED_SPACES } from '../../lib/visibleText'
import { parseLastMonth } from './lastMonth'
import type { ListedTransaction } from './transactions'

/*
 * 연결이 없을 때 서버 대신 기기의 최근 31일 사본(#238)에서 찾는 것의 공통 규칙. 중복 경고(F-209, duplicates.ts)와 카테고리
 * 제안(P-219, categorySuggestion.ts)이 서버(#59, #61)와 같은 줄을 고르려고 쓴다. 기기에 쌓은(보내지 않은) 입력은 보지 않는다
 * (planner #241 P2, #348 2). 거래 입력과 한 줄 입력 결과 확인의 조각에만 들어간다.
 */

/** 거래의 주인(sessionUserId)과 장부. 사본은 그 사용자의 것만 읽는다 */
export interface KeptOwner {
  userId: string | undefined
  ledgerId: string
}

/** 그 사용자의 사본에 있는 그 장부의 거래(서버가 정한 목록 순서). 사본이 없거나 모양이 다르면 비어 있다. 읽지 못하면 던진다 */
export async function keptTransactions({ userId, ledgerId }: KeptOwner): Promise<ListedTransaction[]> {
  if (userId === undefined) return []
  const copy = await readCopy(userId, ledgerId, 'transactions')
  const kept = copy && parseLastMonth(copy.data)
  return kept ? kept.items : []
}

/** 서버와 같이 맞춘 가맹점(#59, #61의 비교): 조합형으로 맞추고 공백류(TRIMMED_SPACES)를 모두 빼고 소문자로 */
export function payeeKeyOf(payee: string): string {
  return [...payee.normalize('NFC')]
    .filter((character) => !TRIMMED_SPACES.includes(character))
    .join('')
    .toLowerCase()
}

/**
 * 서버의 "가장 최근": 저장 시각(created_at) 최신 순, 같으면 id 큰 순. 저장 시각은 목록 응답(#15)에 있어 사본에도 있지만
 * 화면이 그리지 않아 타입에 없고 모양만 본다(없으면 가장 오래된 것으로 본다).
 */
export function byLatestSaved(a: ListedTransaction, b: ListedTransaction): number {
  return compare(savedAtOf(b), savedAtOf(a)) || compare(b.id.toLowerCase(), a.id.toLowerCase())
}

function savedAtOf(item: ListedTransaction): string {
  const createdAt = (item as Partial<Record<'createdAt', unknown>>).createdAt
  return typeof createdAt === 'string' ? createdAt : ''
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
