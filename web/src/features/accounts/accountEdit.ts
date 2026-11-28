import { ApiError } from '../../api/apiError'
import { request } from '../../api/request'
import { isDate } from '../../lib/calendarDate'
import { isUuid } from '../../lib/uuid'
import { ledgerPath } from '../me/ledgerPath'
import { isAccount, type Account, type NewAccount } from './accounts'

/*
 * 계좌 수정(G-02 수정 모드, #33의 계약). 수정 화면 조각만 쓰므로 계좌 목록(첫 화면 묶음이 읽는 accounts.ts)과 나눈다.
 */

/** 수정 화면이 채울 수 있는 계좌 */
export interface EditableAccount extends Account {
  /** 저장된 시작 잔액. 원 단위 정수이고 카드의 갚을 금액은 음수다. */
  openingBalance: number
  /** `YYYY-MM-DD` */
  openingDate: string
}

/** 시작 잔액과 기준일이 약속대로인 계좌. 아니면(이것을 담기 전에 남긴 기기 사본 등) 없다. */
export function editableAccountOf(account: Account): EditableAccount | undefined {
  const { openingBalance, openingDate } = account
  if (!Number.isSafeInteger(openingBalance) || typeof openingDate !== 'string' || !isDate(openingDate)) return undefined
  return account as EditableAccount
}

/**
 * 계좌 하나를 고친다(#33, F-503). 본문은 추가와 같고 거부 code도 같다. 고친 계좌를 주고, 잔액은 바꾼 시작 잔액과 기준일로 서버가
 * 다시 구한 값이다(P-206). 그 장부에 없는 계좌는 404다. 수정 충돌 검사는 없어 나중 저장이 남는다(P-217). 실패하면 ApiError를 던진다.
 */
export async function updateAccount(ledgerId: string, accountId: string, account: NewAccount): Promise<Account> {
  // 계좌 id도 주소에 넣기 전에 UUID 모양인지 본다(ledgerPath와 같다)
  if (!isUuid(accountId)) throw ApiError.unreadable()
  const body = await request<Partial<Account> | null | undefined>(ledgerPath(ledgerId, `accounts/${accountId}`), {
    method: 'PUT',
    body: account,
  })
  if (!isAccount(body) || body.id !== accountId) throw ApiError.unreadable()
  return body
}
