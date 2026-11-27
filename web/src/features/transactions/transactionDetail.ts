import { ApiError } from '../../api/apiError'
import { request } from '../../api/request'
import { isUuid } from '../../lib/uuid'
import { ledgerPath } from '../me/ledgerPath'
import { isListedTransaction, isPerson, type TransactionDetail } from './transactions'

/*
 * 거래 하나의 경로와 상세(#15). 거래 상세, 거래 수정, 고쳐서 보내기와 쓰기 요청(transactionWrites.ts)이 쓴다.
 * 홈은 쓰지 않으므로 첫 화면 JS에 들지 않게 transactions.ts와 나눠 둔다(#355). 상세의 모양(TransactionDetail)은 transactions.ts에 있다.
 */

/** 장부의 거래 하나. 휴지통에 있으면 deletedAt이 차서 온다. 없거나 다른 장부의 것이면 404 거부다. 실패하면 ApiError를 던진다. */
export async function fetchTransaction(ledgerId: string, id: string): Promise<TransactionDetail> {
  const body = await request<unknown>(transactionPath(ledgerId, id))
  if (!isTransactionDetail(body) || !isSameId(body.id, id)) throw ApiError.unreadable()
  return body
}

/** 없는 거래라는 거부(404). 완전히 지운 거래와 다른 장부의 거래를 서버가 나누지 않는다(P-903). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/** 거래 하나의 경로. 거래 id도 주소에 넣기 전에 UUID 모양인지 본다(ledgerPath와 같다). */
export function transactionPath(ledgerId: string, id: string): `/${string}` {
  if (!isUuid(id)) throw ApiError.unreadable()
  return ledgerPath(ledgerId, `transactions/${id}`)
}

export function isSameId(received: string, requested: string): boolean {
  return received.toLowerCase() === requested.toLowerCase()
}

/** 서버가 기록한 시각(ADR 002 2절): UTC, `Z`, 밀리초 3자리 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function isInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false
  // 없는 날(2월 30일 등)은 Date가 다음 달로 넘기므로 다시 적어 같은지 본다
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

/** 상세의 모양(#15)인지. 목록의 거래도 상세의 값을 모두 싣고 오면 상세로 그릴 수 있다(기기의 최근 한 달, #238). */
export function isTransactionDetail(value: unknown): value is TransactionDetail {
  if (!isListedTransaction(value)) return false
  const body = value as Partial<Record<keyof TransactionDetail, unknown>>
  return (
    (body.memo === null || typeof body.memo === 'string') &&
    (body.createdBy === null || isPerson(body.createdBy)) &&
    isInstant(body.updatedAt) &&
    // 휴지통에 있을 때만 영구 삭제 예정 시각이 있다
    (body.deletedAt === null ? body.purgeAt === null : isInstant(body.purgeAt))
  )
}
