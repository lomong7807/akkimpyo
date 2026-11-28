import { ApiError } from '../../api/apiError'
import { request } from '../../api/request'
import { ledgerPath } from '../me/ledgerPath'

/* 계좌의 경로와 필드 이름(#13, #33의 응답 계약)은 이 파일에만 있다. */

/** 화면에 묶음을 놓는 순서이기도 하다. */
export const accountTypes = ['BANK', 'CARD', 'CASH'] as const

export type AccountType = (typeof accountTypes)[number]

export interface Account {
  id: string
  name: string
  type: AccountType
  /** 원 단위 정수. 카드의 갚을 금액은 음수로 온다. */
  balance: number
  /**
   * 저장된 시작 잔액(원 단위 정수, 카드는 음수)과 기준일(`YYYY-MM-DD`). 서버는 늘 주지만(#33) 목록은 이 둘을 보지 않고 받는다.
   * 이것을 담기 전에 남긴 기기 사본도 그대로 읽기 위해서다. 수정 화면만 쓰고 accountEdit.ts의 editableAccountOf로 확인한다.
   */
  openingBalance?: unknown
  openingDate?: unknown
}

/** 만든 순서대로 준다. 실패하면 ApiError를 던진다. */
export async function fetchAccounts(ledgerId: string): Promise<Account[]> {
  const body = await request<{ items?: unknown } | null | undefined>(ledgerPath(ledgerId, 'accounts'))
  const items = parseAccounts(body?.items)
  if (!items) throw ApiError.unreadable()
  return items
}

/** 약속(#13)대로인 계좌 목록. 기기에 남긴 사본도 이것으로 읽는다(값은 믿지 않는다). 하나라도 읽을 수 없으면 없다. */
export function parseAccounts(items: unknown): Account[] | undefined {
  // 하나라도 읽을 수 없으면 모두 받지 않는다. 빼고 보이면 합계가 틀린다
  return Array.isArray(items) && items.every(isAccount) ? items : undefined
}

/** 추가할 계좌 */
export interface NewAccount {
  name: string
  type: AccountType
  /** 원 단위 정수. 카드의 갚을 금액은 음수로 보낸다. */
  openingBalance: number
  /** `YYYY-MM-DD` */
  openingDate: string
}

/** 만들어진 계좌를 준다. 실패하면 ApiError를 던진다. */
export async function createAccount(ledgerId: string, account: NewAccount): Promise<Account> {
  const body = await request<Partial<Account> | null | undefined>(ledgerPath(ledgerId, 'accounts'), {
    method: 'POST',
    body: account,
  })
  if (!isAccount(body)) throw ApiError.unreadable()
  return body
}

/** 약속(#13)대로인 계좌 하나. 시작 잔액과 기준일은 보지 않는다(Account). */
export function isAccount(value: Partial<Account> | null | undefined): value is Account {
  return (
    typeof value?.id === 'string' &&
    typeof value.name === 'string' &&
    accountTypes.some((type) => type === value.type) &&
    Number.isSafeInteger(value.balance)
  )
}
