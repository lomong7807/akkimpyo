import { accountTypes, type Account } from '../accounts/accounts'
import type { Category, CategoryKind } from '../categories/categories'
import { readLastAccount } from './lastAccount'

/**
 * 계좌 칸의 기본값(D-04 칸별 기본값, F-102). 이 사용자가 이 장부에서 마지막으로 쓴 계좌이고, 기록이 없거나 쓸 수 없으면
 * 계좌 목록(G-01)의 첫 계좌다. 계좌가 하나도 없으면 빈 글자다.
 */
export function defaultAccountOf(owner: { userId: string | undefined; ledgerId: string }, accounts: Account[]): string {
  const ordered = accountTypes.flatMap((type) => accounts.filter((account) => account.type === type))
  return readLastAccount(owner, ordered.map(({ id }) => id)) ?? ordered[0]?.id ?? ''
}

/** 고른 카테고리의 구분. 목록에 없으면 없다. */
export function categoryKindOf(categories: Category[] | undefined, id: string): CategoryKind | undefined {
  return categories?.find((category) => category.id === id || category.children.some((child) => child.id === id))
    ?.kind
}
