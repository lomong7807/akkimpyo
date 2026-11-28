import { ApiError } from '../../api/apiError'
import { request, requestForResponse } from '../../api/request'
import { deviceValueOf } from '../../lib/deviceValue'
import { isUuid } from '../../lib/uuid'
import { ledgerPath } from '../me/ledgerPath'
import { isSameId, isTransactionDetail, transactionPath } from './transactionDetail'
import {
  isSavedTransaction,
  type CreateResult,
  type NewTransaction,
  type SavedTransaction,
  type TransactionDetail,
  type TransactionUpdate,
} from './transactions'

/*
 * 거래 만들기(#14), 삭제와 복원(#38), 수정(#36)의 요청과 그 헤더, 거부의 판정. 거래 입력, 한 줄 입력의 저장, 거래 상세·수정,
 * 쌓인 입력 보내기(sendQueue)가 쓴다. 홈이 처음 그릴 때는 쓰지 않으므로 첫 화면 JS에 들지 않게 transactions.ts와 나눠 둔다(#355).
 * 본문의 모양(NewTransaction, TransactionUpdate)과 응답의 모양 검사는 transactions.ts에 있다.
 */

/** 쓰기 요청의 기기 값을 싣는 헤더(#14) */
const DEVICE_HEADER = 'X-Akkimpyo-Device'

/**
 * 거래 하나를 만든다. 요청은 하나다. `startedBy`는 저장을 시작한 때의 사용자이고, 보내는 순간의 사용자(토큰의 sub)가
 * 그와 다르면 보내지 않고 지연 오류로 끝낸다(security #79 권고 A). 그사이 같은 탭에서 다른 계정으로 로그인했으면 앞 사용자의
 * 입력이 새 사용자의 이름으로 나가지 않게 한다. 검사는 요청 계층이 보내기 직전마다(갱신해 다시 보낼 때 포함) 한다.
 * 실패하면 ApiError를 던진다.
 */
export async function createTransaction(
  ledgerId: string,
  transaction: NewTransaction,
  startedBy: string | undefined,
): Promise<CreateResult> {
  const path = ledgerPath(ledgerId, 'transactions')
  const { status, body } = await requestForResponse<unknown>(
    path,
    { method: 'POST', body: transaction, headers: deviceHeaders() },
    { startedBy },
  )
  if ((status !== 200 && status !== 201) || !isSavedTransaction(body)) throw ApiError.unreadable(status)
  return { created: status === 201, transaction: body }
}

/** 쓰기 요청의 기기 값. user agent 원문은 보내지 않는다. 목록의 값 하나로 줄인다 */
function deviceHeaders(): Record<string, string> {
  return { [DEVICE_HEADER]: deviceValueOf(navigator.userAgent) }
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
 * current가 약속대로의 거래이고 보낸 거래 id(`id`)의 것이면 그 거래도 준다. 선택 판(ADR 006 결정 3)이 쓴다.
 */
export function idConflictOf(
  error: unknown,
  id?: string,
): { savedId?: string; current?: TransactionDetail } | undefined {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'ID_CONFLICT') return undefined
  const current: unknown = error.current
  const savedId = typeof current === 'object' && current !== null && 'id' in current ? current.id : undefined
  if (!isUuid(savedId)) return {}
  const conflict = { savedId: savedId.toLowerCase() }
  return id !== undefined && isTransactionDetail(current) && isSameId(current.id, id) ? { ...conflict, current } : conflict
}

/**
 * 거래를 휴지통으로 옮긴다. `version`은 화면이 본 거래의 것이다. 요청은 하나이고 `startedBy`는 createTransaction과 같다.
 * 바뀐 거래(deletedAt이 차고 version이 오른 것)를 준다. 되돌리기는 그 version으로 복원한다. 실패하면 ApiError를 던진다.
 */
export async function deleteTransaction(
  ledgerId: string,
  id: string,
  version: number,
  startedBy: string | undefined,
): Promise<SavedTransaction> {
  const path = `${transactionPath(ledgerId, id)}?${new URLSearchParams({ version: String(version) })}` as const
  const body = await request<unknown>(path, { method: 'DELETE', headers: deviceHeaders() }, { startedBy })
  if (!isSavedTransaction(body) || !isSameId(body.id, id) || body.deletedAt === null) throw ApiError.unreadable()
  return body
}

/**
 * 거래 하나를 고친다(#36). 요청은 하나이고 `startedBy`는 createTransaction과 같다. 바뀐 거래를 준다. 내용이 저장된 것과
 * 같으면 서버가 version을 올리지 않는다. 받은 거래로 상세를 그리므로 상세와 같은 모양이고 휴지통에 없어야 받는다.
 * 낡은 version은 409 STALE_VERSION(staleVersionOf), version은 맞는데 휴지통이면 409 INVALID_STATE(isInvalidState),
 * 완전히 지웠거나 다른 장부의 것이면 404 거부다. 실패하면 ApiError를 던진다.
 */
export async function updateTransaction(
  ledgerId: string,
  id: string,
  update: TransactionUpdate,
  startedBy: string | undefined,
): Promise<TransactionDetail> {
  const path = transactionPath(ledgerId, id)
  const body = await request<unknown>(path, { method: 'PUT', body: update, headers: deviceHeaders() }, { startedBy })
  if (!isTransactionDetail(body) || !isSameId(body.id, id) || body.deletedAt !== null) throw ApiError.unreadable()
  return body
}

/** 휴지통의 거래를 되살린다. `version`은 삭제 응답의 것이다. 나머지는 deleteTransaction과 같다. */
export async function restoreTransaction(
  ledgerId: string,
  id: string,
  version: number,
  startedBy: string | undefined,
): Promise<SavedTransaction> {
  const path = `${transactionPath(ledgerId, id)}/restore` as const
  const body = await request<unknown>(path, { method: 'POST', body: { version }, headers: deviceHeaders() }, { startedBy })
  if (!isSavedTransaction(body) || !isSameId(body.id, id) || body.deletedAt !== null) throw ApiError.unreadable()
  return body
}

/**
 * 낡은 version으로 바꾸려 했다는 거부(409 STALE_VERSION). 아니면 없다.
 * 서버의 최신 거래(current)가 약속대로이고 그 거래의 것이면 준다. 휴지통에 있으면 deletedAt이 차 있다.
 */
export function staleVersionOf(error: unknown, id: string): { current?: TransactionDetail } | undefined {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'STALE_VERSION') return undefined
  const current: unknown = error.current
  return isTransactionDetail(current) && isSameId(current.id, id) ? { current } : {}
}

/** version은 맞는데 지금 상태에서 할 수 없다는 거부(409 INVALID_STATE). 이미 지운 거래를 지우려 한 것 등이다. */
export function isInvalidState(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'INVALID_STATE'
}
