import { ApiError } from '../../api/apiError'
import { request, requestForResponse } from '../../api/request'
import { isDate, monthOf } from '../../lib/calendarDate'
import { deviceValueOf } from '../../lib/deviceValue'
import { isValidTime } from '../../lib/timeText'
import { isUuid } from '../../lib/uuid'
import { ledgerPath } from '../me/ledgerPath'

/*
 * 거래 만들기의 경로, 헤더, 필드 이름(#14의 요청과 응답 계약), 거래 목록(한 달, 장부 전체)과 상세의 경로, 쿼리, 필드 이름(#15의 응답 계약),
 * 삭제와 복원의 경로, 쿼리, 본문(#38의 계약), 수정의 경로와 본문(#36의 계약)은 이 파일에만 있다.
 */

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

/** 거래 id를 뺀 본문. 지출·수입과 이체를 나눈 채 뺀다. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

/** 거래에 넣는 값. 만들기의 본문에서 거래 id를 뺀 것이다. */
export type TransactionContent = WithoutId<NewTransaction>

/**
 * 거래 수정의 본문(#36). 만들기 모양에서 거래 id를 빼고(id는 경로에 있다) 화면이 연 때의 version을 더한다.
 * 유형은 저장된 것과 같아야 한다(P-213). 다르면 서버가 400(type, NOT_ALLOWED)으로 거부한다.
 */
export type TransactionUpdate = TransactionContent & { version: number }

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

/** 목록에 보이는 거래의 공통 값(#15). 만들기 응답과 같은 모양에서 줄을 그리는 값을 더 본다. */
interface ListedBase extends SavedTransaction {
  /** `YYYY-MM-DD` */
  occurredOn: string
  /** `HH:mm`. 없으면 null */
  occurredTime: string | null
  /** 원 단위 양의 정수 */
  amount: number
}

export interface ListedIncomeOrExpense extends ListedBase {
  type: 'EXPENSE' | 'INCOME'
  accountId: string
  /** 미분류면 그 장부의 미분류 카테고리다. */
  categoryId: string
  payee: string | null
}

export interface ListedTransfer extends ListedBase {
  type: 'TRANSFER'
  fromAccountId: string
  toAccountId: string
}

export type ListedTransaction = ListedIncomeOrExpense | ListedTransfer

/** 수입·지출 합계(P-205: 이체, 취소, 삭제를 뺀다). 지출도 양수다. */
export interface IncomeAndExpense {
  income: number
  expense: number
}

export interface DayTotal extends IncomeAndExpense {
  /** `YYYY-MM-DD` */
  date: string
}

/** 거래 목록의 한 쪽 */
export interface TransactionPage {
  /** 서버가 정한 순서(날짜 역순, 같은 날은 시각 있는 것이 시각 역순으로 먼저, 같으면 id 역순). 휴지통의 거래는 없다. */
  items: ListedTransaction[]
  /** 다음 쪽을 받을 글자. 해석하지 않고 그대로 보낸다. 마지막 쪽이면 null */
  nextCursor: string | null
  /** 그 달 전체의 합계. 첫 쪽에만 있다. */
  totals: IncomeAndExpense | null
  /** 이 쪽에 나온 날짜마다 그날 전체의 합계. 한 날이 두 쪽에 걸쳐도 같은 값이다. */
  days: DayTotal[]
}

/** 한 번에 받는 거래 수(P-232) */
export const PAGE_SIZE = 50

/**
 * 장부의 한 달 거래를 한 쪽 받는다. `cursor`가 null이면 첫 쪽이다. 실패하면 ApiError를 던진다.
 * 약속과 다른 응답은 일부만 쓰지 않고 모두 받지 않는다. 빼고 보이면 합계와 줄이 어긋난다.
 */
export async function fetchTransactionPage(
  ledgerId: string,
  month: string,
  cursor: string | null,
): Promise<TransactionPage> {
  const query = new URLSearchParams({ month, limit: String(PAGE_SIZE) })
  if (cursor !== null) query.set('cursor', cursor)
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'transactions')}?${query}`)
  if (!isTransactionPage(body, month, cursor === null)) throw ApiError.unreadable()
  return body
}

/**
 * 장부의 한 달 합계(P-205). 그 달의 첫 쪽을 한 건만 받아 합계(totals)만 쓴다(홈의 이번 달 합계, F-111).
 * 실패하면 ApiError를 던진다.
 */
export async function fetchMonthTotals(ledgerId: string, month: string): Promise<IncomeAndExpense> {
  const query = new URLSearchParams({ month, limit: '1' })
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'transactions')}?${query}`)
  if (!isTransactionPage(body, month, true)) throw ApiError.unreadable()
  // 첫 쪽에는 합계가 늘 있다(isTransactionPage)
  return body.totals!
}

/** 홈에 보이는 최근 거래 수(F-113) */
export const RECENT_COUNT = 10

/** 장부 전체의 최근 거래 */
export interface RecentTransactions {
  /** 서버가 정한 순서(목록과 같다). 장부 시간대의 오늘까지의 거래만 온다(서버가 거른다). */
  items: ListedTransaction[]
  /** 받은 거래의 날짜마다 그날 전체의 합계 */
  days: DayTotal[]
}

/**
 * 장부 전체에서 가장 최근 거래 10건(F-113). 달을 보내지 않는다. 다음 쪽(nextCursor)은 쓰지 않는다. 달 기준 cursor와
 * 섞이지 않게 받지 않는다. 받은 거래를 화면에서 거르지 않는다. 실패하면 ApiError를 던진다.
 */
export async function fetchRecentTransactions(ledgerId: string): Promise<RecentTransactions> {
  const query = new URLSearchParams({ limit: String(RECENT_COUNT) })
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'transactions')}?${query}`)
  if (!isTransactionPage(body, null, true)) throw ApiError.unreadable()
  return { items: body.items, days: body.days }
}

/** 한 쪽의 모양이 약속(#15)과 같은지. `month`가 null이면 장부 전체의 쪽이라 합계가 없고 달을 보지 않는다. */
function isTransactionPage(value: unknown, month: string | null, first: boolean): value is TransactionPage {
  if (typeof value !== 'object' || value === null) return false
  const { items, nextCursor, totals, days } = value as Partial<Record<keyof TransactionPage, unknown>>
  if (!Array.isArray(items) || !Array.isArray(days)) return false
  const inMonth = (date: string) => month === null || monthOf(date) === month
  if (!items.every((item) => isListedTransaction(item) && inMonth(item.occurredOn))) return false
  if (!days.every((day) => isDayTotal(day) && inMonth(day.date))) return false
  const dates = new Set(days.map(({ date }) => date))
  const totalsKept = month === null ? totals === null : isIncomeAndExpense(totals) || (!first && totals === null)
  return (
    items.every(({ occurredOn }) => dates.has(occurredOn)) &&
    (nextCursor === null || (typeof nextCursor === 'string' && nextCursor !== '')) &&
    totalsKept
  )
}

function isListedTransaction(value: unknown): value is ListedTransaction {
  if (!isSavedTransaction(value)) return false
  const body = value as Partial<Record<keyof ListedIncomeOrExpense | keyof ListedTransfer, unknown>>
  const shared =
    isUuid(body.id) &&
    typeof body.occurredOn === 'string' &&
    isDate(body.occurredOn) &&
    (body.occurredTime === null || (typeof body.occurredTime === 'string' && isValidTime(body.occurredTime))) &&
    Number.isSafeInteger(body.amount) &&
    (body.amount as number) >= 1
  if (!shared) return false
  if (body.type === 'TRANSFER') return typeof body.fromAccountId === 'string' && typeof body.toAccountId === 'string'
  return (
    typeof body.accountId === 'string' &&
    typeof body.categoryId === 'string' &&
    (body.payee === null || typeof body.payee === 'string')
  )
}

function isIncomeAndExpense(value: unknown): value is IncomeAndExpense {
  if (typeof value !== 'object' || value === null) return false
  const { income, expense } = value as Partial<Record<keyof IncomeAndExpense, unknown>>
  return [income, expense].every((amount) => Number.isSafeInteger(amount) && (amount as number) >= 0)
}

function isDayTotal(value: unknown): value is DayTotal {
  if (!isIncomeAndExpense(value)) return false
  const { date } = value as Partial<Record<keyof DayTotal, unknown>>
  return typeof date === 'string' && isDate(date)
}

/** 거래 상세(#15). 목록의 거래와 같은 모양에서 상세에만 보이는 값을 더 본다. */
export type TransactionDetail = ListedTransaction & {
  memo: string | null
  /** 만든 사람. 탈퇴했으면 null */
  createdBy: Person | null
  /** 휴지통에서 영구 삭제될 시각(ISO 8601 UTC). 휴지통에 없으면 null이다. 화면은 날 수를 따로 세지 않고 이것을 쓴다. */
  purgeAt: string | null
  /** 마지막으로 고친 시각(ISO 8601 UTC, ADR 002 2절). 수정 충돌 안내(N-04)가 보인다. */
  updatedAt: string
}

/** 장부의 거래 하나. 휴지통에 있으면 deletedAt이 차서 온다. 없거나 다른 장부의 것이면 404 거부다. 실패하면 ApiError를 던진다. */
export async function fetchTransaction(ledgerId: string, id: string): Promise<TransactionDetail> {
  const body = await request<unknown>(transactionPath(ledgerId, id))
  if (!isTransactionDetail(body) || !isSameId(body.id, id)) throw ApiError.unreadable()
  return body
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

/** 없는 거래라는 거부(404). 완전히 지운 거래와 다른 장부의 거래를 서버가 나누지 않는다(P-903). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/** 거래 하나의 경로. 거래 id도 주소에 넣기 전에 UUID 모양인지 본다(ledgerPath와 같다). */
function transactionPath(ledgerId: string, id: string): `/${string}` {
  if (!isUuid(id)) throw ApiError.unreadable()
  return ledgerPath(ledgerId, `transactions/${id}`)
}

function isSameId(received: string, requested: string): boolean {
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

function isTransactionDetail(value: unknown): value is TransactionDetail {
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
