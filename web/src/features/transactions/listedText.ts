import { towardParticle } from '../../lib/particle'
import type { Account } from '../accounts/accounts'
import type { Category } from '../categories/categories'
import type { ListedTransaction } from './transactions'

/** 미분류 카테고리의 이름. 미분류는 이름이 아니라 system 표시로 안다. */
const UNCATEGORIZED = '미분류'

/** 거래 목록의 계좌·카테고리 id를 이름으로 바꾼다. 목록에 없는 id는 이름이 없다. */
export interface NameBook {
  account(id: string): string | undefined
  /** 하위 카테고리면 하위 이름만이다(0.4). */
  category(id: string): string | undefined
  /** 하위 카테고리면 상위 이름을 괄호로 붙인다: "외식 (식비)"(D-06 (5)). */
  categoryWithParent(id: string): string | undefined
}

export function nameBookOf(accounts: Account[], categories: Category[]): NameBook {
  const accountNames = new Map(accounts.map(({ id, name }) => [id, name]))
  const topNames = categories.map(({ id, name, system }) => [id, system ? UNCATEGORIZED : name] as const)
  const childNames = categories.flatMap(({ name, children }) =>
    children.map((child) => ({ id: child.id, name: child.name, parent: name })),
  )
  const categoryNames = new Map([...topNames, ...childNames.map(({ id, name }) => [id, name] as const)])
  const withParent = new Map([...topNames, ...childNames.map(({ id, name, parent }) => [id, `${name} (${parent})`] as const)])
  return {
    account: (id) => accountNames.get(id),
    category: (id) => categoryNames.get(id),
    categoryWithParent: (id) => withParent.get(id),
  }
}

/** 줄의 제목(0.4): 가맹점/내용, 없으면 카테고리 이름(미분류면 "미분류"), 이체는 "이체" */
export function titleOf(transaction: ListedTransaction, names: NameBook): string {
  if (transaction.type === 'TRANSFER') return '이체'
  return transaction.payee || (names.category(transaction.categoryId) ?? '')
}

/**
 * 줄의 둘째 줄(0.4): "식비 · 신한카드", 이체는 "국민은행에서 국민카드로". 이름이 없는 자리는 빼고 잇는다.
 */
export function detailOf(transaction: ListedTransaction, names: NameBook): string {
  if (transaction.type !== 'TRANSFER') {
    return [names.category(transaction.categoryId), names.account(transaction.accountId)].filter(Boolean).join(' · ')
  }
  const from = names.account(transaction.fromAccountId)
  const to = names.account(transaction.toAccountId)
  return [from && `${from}에서`, to && `${to}${towardParticle(to)}`].filter(Boolean).join(' ')
}
