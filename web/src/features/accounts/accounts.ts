import { ApiError } from '../../api/apiError'
import { request } from '../../api/request'

/* 계좌의 경로와 필드 이름(#13의 응답 계약)은 이 파일에만 있다. */

/** 화면에 묶음을 놓는 순서이기도 하다. */
export const accountTypes = ['BANK', 'CARD', 'CASH'] as const

export type AccountType = (typeof accountTypes)[number]

export interface Account {
  id: string
  name: string
  type: AccountType
  /** 원 단위 정수. 카드의 갚을 금액은 음수로 온다. */
  balance: number
}

/** 만든 순서대로 준다. 실패하면 ApiError를 던진다. */
export async function fetchAccounts(ledgerId: string): Promise<Account[]> {
  const body = await request<{ items?: unknown } | null | undefined>(`/ledgers/${ledgerId}/accounts`)
  const items = body?.items
  // 하나라도 읽을 수 없으면 모두 받지 않는다. 빼고 보이면 합계가 틀린다
  if (!Array.isArray(items) || !items.every(isAccount)) throw ApiError.unreadable()
  return items
}

function isAccount(value: Partial<Account> | null): value is Account {
  return (
    typeof value?.id === 'string' &&
    typeof value.name === 'string' &&
    accountTypes.some((type) => type === value.type) &&
    Number.isSafeInteger(value.balance)
  )
}
