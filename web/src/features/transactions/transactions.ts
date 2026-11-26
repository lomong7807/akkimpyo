import { ApiError } from '../../api/apiError'
import { requestForResponse } from '../../api/request'
import { currentUserId } from '../../api/session'
import { deviceValueOf } from '../../lib/deviceValue'
import { isUuid } from '../../lib/uuid'

/* 거래 만들기의 경로, 헤더, 필드 이름(#14의 요청과 응답 계약)은 이 파일에만 있다. */

export const transactionTypes = ['EXPENSE', 'INCOME', 'TRANSFER'] as const

export type TransactionType = (typeof transactionTypes)[number]

const statuses = ['PENDING', 'POSTED', 'CANCELED'] as const

/** 지출·수입. 날짜와 시각은 시간대 없이 입력한 그대로 보낸다. */
export interface NewIncomeOrExpense {
  /** 기기가 만든 UUID v7 */
  id: string
  type: 'EXPENSE' | 'INCOME'
  /** `YYYY-MM-DD` */
  occurredOn: string
  /** `HH:mm`. 없으면 null */
  occurredTime: string | null
  accountId: string
  /** 비우면 null이고 서버가 미분류로 저장한다. */
  categoryId: string | null
  /** 원 단위 양의 정수 */
  amount: number
  payee: string | null
  memo: string | null
}

export interface NewTransfer {
  id: string
  type: 'TRANSFER'
  occurredOn: string
  occurredTime: string | null
  fromAccountId: string
  toAccountId: string
  amount: number
  memo: string | null
}

export type NewTransaction = NewIncomeOrExpense | NewTransfer

interface Person {
  id: string
  displayName: string
}

/** 서버가 저장한 거래에서 화면이 보는 값. 다른 값은 그대로 두고 쓰지 않는다. */
export interface SavedTransaction {
  id: string
  type: TransactionType
  status: (typeof statuses)[number]
  /** 만든 뒤 고치지 않았으면 1 */
  version: number
  /** 휴지통에 있으면 옮긴 시각 */
  deletedAt: string | null
  /** 결제한 사람. 응답에 항목이 없는 것(undefined)과 값이 비어 있는 것(null, 탈퇴)을 나눈다(ADR 006 결정 3). */
  paidBy?: Person | null
}

export interface CreateResult {
  /** 새로 만들었으면(201) true, 같은 id를 다시 보낸 것이면(200) false */
  created: boolean
  transaction: SavedTransaction
}

/** 쓰기 요청의 기기 값을 싣는 헤더(#14) */
const DEVICE_HEADER = 'X-Akkimpyo-Device'

/**
 * 거래 하나를 만든다. 요청은 하나다. `startedBy`는 저장을 시작한 때의 사용자이고, 보내는 순간의 사용자가 그와 다르면
 * 보내지 않는다(security #79 권고 A). 그사이 같은 탭에서 다른 계정으로 로그인했으면 앞 사용자의 입력이 새 사용자의
 * 이름으로 나가지 않게 한다. 토큰을 갱신해 다시 보낼 때의 같은 검사는 세션 계층이 한다.
 * 실패하면 ApiError를 던진다.
 */
export async function createTransaction(
  ledgerId: string,
  transaction: NewTransaction,
  startedBy: string | undefined,
): Promise<CreateResult> {
  if (startedBy === undefined || currentUserId() !== startedBy) throw ApiError.timeout()
  const { status, body } = await requestForResponse<unknown>(`/ledgers/${ledgerId}/transactions`, {
    method: 'POST',
    body: transaction,
    // user agent 원문은 보내지 않는다. 목록의 값 하나로 줄인다
    headers: { [DEVICE_HEADER]: deviceValueOf(navigator.userAgent) },
  })
  if ((status !== 200 && status !== 201) || !isSavedTransaction(body)) throw ApiError.unreadable(status)
  return { created: status === 201, transaction: body }
}

/**
 * 다시 보낸 거래(200)가 이미 서버에서 바뀐 것인지(ADR 006 결정 3). 고쳐졌거나, 휴지통에 있거나, 취소됐거나,
 * 지출·수입인데 결제한 사람의 값이 비었으면 알린다. 보낸 내용과 받은 내용은 비교하지 않는다.
 */
export function needsResendNotice({ created, transaction }: CreateResult): boolean {
  if (created) return false
  const { type, version, deletedAt, status } = transaction
  const payerLeft = type !== 'TRANSFER' && 'paidBy' in transaction && transaction.paidBy === null
  return version >= 2 || deletedAt !== null || status === 'CANCELED' || payerLeft
}

/**
 * 그 id로 만들 수 없다는 거부(409 ID_CONFLICT). 아니면 없다.
 * 앞서 같은 id로 저장한 내 거래가 있으면(current) 그 id를 준다. 주소에 넣으므로 UUID 모양일 때만 준다.
 */
export function idConflictOf(error: unknown): { savedId?: string } | undefined {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'ID_CONFLICT') return undefined
  const current: unknown = error.current
  const savedId = typeof current === 'object' && current !== null && 'id' in current ? current.id : undefined
  return isUuid(savedId) ? { savedId: savedId.toLowerCase() } : {}
}

function isSavedTransaction(value: unknown): value is SavedTransaction {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Partial<Record<keyof SavedTransaction, unknown>>
  return (
    typeof body.id === 'string' &&
    transactionTypes.some((type) => type === body.type) &&
    statuses.some((status) => status === body.status) &&
    Number.isSafeInteger(body.version) &&
    (body.version as number) >= 1 &&
    (body.deletedAt === null || typeof body.deletedAt === 'string') &&
    (!('paidBy' in body) || body.paidBy === null || isPerson(body.paidBy))
  )
}

function isPerson(value: unknown): value is Person {
  if (typeof value !== 'object' || value === null) return false
  const person = value as Partial<Record<keyof Person, unknown>>
  return typeof person.id === 'string' && typeof person.displayName === 'string'
}
