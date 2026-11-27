import { ApiError } from '../../api/apiError'
import { connection } from '../../api/connection'
import { request } from '../../api/request'
import { readCopy } from '../../device/copies'
import { TRIMMED_SPACES } from '../../lib/visibleText'
import { isConnectionLost } from '../connection/offlineAction'
import { ledgerPath } from '../me/ledgerPath'
import { parseLastMonth } from './lastMonth'
import { isTransactionDetail } from './transactionDetail'
import type { NewTransaction, TransactionDetail } from './transactions'

/*
 * 중복 경고(F-209, P-218, #241)의 묻기. 조회의 경로, 쿼리, 필드 이름(#59의 계약)은 이 파일에만 있다. 새 거래 저장
 * (useNewTransactionSave)이 기기 검증 다음, 보내기 전에 부른다. 거래 입력과 한 줄 입력 결과 확인의 조각에만 들어간다
 * (첫 화면 묶음에 넣지 않는다).
 */

/** 서버가 주는 맞는 거래의 최대 수(#59). 연결이 없을 때도 같은 수로 자른다 */
const MATCH_LIMIT = 5

/** 무엇과 같은 거래를 찾는지 */
export interface DuplicateQuery {
  /** `YYYY-MM-DD` */
  occurredOn: string
  /** 원 단위 양의 정수 */
  amount: number
  /** 보낼 때처럼 맞춘 가맹점(앞뒤 공백을 지우고 조합형). 비어 있지 않다 */
  payee: string
  /** 저장할 거래의 id. 같은 id로 앞서 저장된 내 거래(응답만 잃은 저장, ADR 006)는 겹친 거래가 아니다 */
  exclude: string
}

/** 거래의 주인(sessionUserId)과 장부. 기기 사본은 그 사용자의 것만 읽는다 */
interface Owner {
  userId: string | undefined
  ledgerId: string
}

/**
 * 보낼 거래에서 찾을 값. 지출·수입이고 가맹점/내용이 있을 때만 묻는다. 이체와 가맹점이 빈 거래는 없다(P-218, F-203).
 * 수정과 "고쳐서 보내기"는 이 길을 지나지 않는다(planner #241 P1).
 */
export function duplicateQueryOf(transaction: NewTransaction): DuplicateQuery | undefined {
  if (transaction.type === 'TRANSFER' || transaction.payee === null || transaction.payee === '') return undefined
  const { occurredOn, amount, payee, id } = transaction
  return { occurredOn, amount, payee, exclude: id }
}

/**
 * 같은 장부에서 날짜·금액·가맹점이 같은 거래를 최근 저장한 순으로 5건까지(P-218). 연결이 있으면 서버가 정하고(#59), 연결이
 * 없거나 묻는 중에 끊기면 그 사용자의 기기 사본(최근 31일, #238)에서만 찾는다(F-209). 묻지 못하면(서버 오류, 15초 지연,
 * 약속과 다른 응답, 사본을 읽을 수 없음) 없는 것으로 본다. 경고는 저장을 막지 않는 안내라서 저장을 이어 간다(planner #241 P3).
 * 실패로 끝나지 않는다.
 */
export async function findDuplicates(owner: Owner, query: DuplicateQuery): Promise<TransactionDetail[]> {
  if (connection() !== 'offline') {
    try {
      return await fetchDuplicates(owner, query)
    } catch (error) {
      if (!isConnectionLost(error)) return []
    }
  }
  return keptDuplicates(owner, query).catch(() => [])
}

/** 서버에 묻는다(#59). 응답의 거래는 상세(#15)와 같은 모양이고 지출·수입만이다. 아니면 ApiError를 던진다 */
async function fetchDuplicates({ userId, ledgerId }: Owner, query: DuplicateQuery): Promise<TransactionDetail[]> {
  const search = new URLSearchParams({
    occurredOn: query.occurredOn,
    amount: String(query.amount),
    payee: query.payee,
    exclude: query.exclude,
  })
  const path = `${ledgerPath(ledgerId, 'transactions/duplicates')}?${search}` as const
  const body = await request<unknown>(path, {}, { startedBy: userId })
  const items = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).items : undefined
  if (!Array.isArray(items) || !items.every((item) => isTransactionDetail(item) && item.type !== 'TRANSFER')) {
    throw ApiError.unreadable()
  }
  return items
}

/**
 * 기기 사본(최근 31일)에서 서버와 같은 조건으로 찾는다. 사본에는 휴지통의 거래가 없고 취소 거래는 있다. 사본의 저장 범위 밖
 * 날짜이면 그날의 거래가 사본에 없어 맞는 거래도 없다. 기기에 쌓은(보내지 않은) 거래끼리는 비교하지 않는다(planner #241 P2).
 */
async function keptDuplicates({ userId, ledgerId }: Owner, query: DuplicateQuery): Promise<TransactionDetail[]> {
  if (userId === undefined) return []
  const copy = await readCopy(userId, ledgerId, 'transactions')
  const kept = copy && parseLastMonth(copy.data)
  if (!kept) return []
  const wanted = payeeKeyOf(query.payee)
  const excluded = query.exclude.toLowerCase()
  return kept.items
    .filter(isTransactionDetail)
    .filter(
      (item) =>
        item.type !== 'TRANSFER' &&
        item.deletedAt === null &&
        item.occurredOn === query.occurredOn &&
        item.amount === query.amount &&
        item.payee !== null &&
        payeeKeyOf(item.payee) === wanted &&
        item.id.toLowerCase() !== excluded,
    )
    .sort(byLatestSaved)
    .slice(0, MATCH_LIMIT)
}

/** 서버와 같이 맞춘 가맹점(#59의 PayeeMatch): 조합형으로 맞추고 공백류(TRIMMED_SPACES)를 모두 빼고 소문자로 */
function payeeKeyOf(payee: string): string {
  return [...payee.normalize('NFC')]
    .filter((character) => !TRIMMED_SPACES.includes(character))
    .join('')
    .toLowerCase()
}

/** 서버의 순서: 저장 시각 최신 순, 같으면 id 큰 순. 저장 시각(createdAt)은 화면이 그리지 않아 모양만 본다 */
function byLatestSaved(a: TransactionDetail, b: TransactionDetail): number {
  return compare(savedAtOf(b), savedAtOf(a)) || compare(b.id.toLowerCase(), a.id.toLowerCase())
}

function savedAtOf(item: TransactionDetail): string {
  const createdAt = (item as Partial<Record<'createdAt', unknown>>).createdAt
  return typeof createdAt === 'string' ? createdAt : ''
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
