import { ApiError } from '../../api/apiError'
import { request, type SenderCheck } from '../../api/request'
import { isDate, monthOf } from '../../lib/calendarDate'
import { isValidTime } from '../../lib/timeText'
import { isUuid } from '../../lib/uuid'
import { ledgerPath } from '../me/ledgerPath'

/*
 * 거래 만들기의 경로, 헤더, 필드 이름(#14의 요청과 응답 계약), 거래 목록(한 달, 하루, 장부 전체)과 상세의 경로, 쿼리, 필드 이름(#15의 응답 계약),
 * 삭제와 복원의 경로, 쿼리, 본문(#38의 계약), 수정의 경로와 본문(#36의 계약)은 이 파일과 같은 폴더의 transactionPages.ts(목록 쪽),
 * transactionDetail.ts(상세), transactionWrites.ts(만들기·수정·삭제·복원)에만 있다. 이 파일에는 거래의 모양과 그 검사, 홈이 처음 그릴 때
 * 쓰는 두 읽기(이번 달 합계, 최근 거래)만 둔다. 나머지는 홈이 쓰지 않아 첫 화면 JS에 들지 않게 나눈다(#355, architect).
 */

export const transactionTypes = ['EXPENSE', 'INCOME', 'TRANSFER'] as const

export type TransactionType = (typeof transactionTypes)[number]

const statuses = ['PENDING', 'POSTED', 'CANCELED'] as const

const refundKinds = ['REFUND', 'REIMBURSEMENT'] as const

/** 지출의 환불 구분(서버 #8, PR #397). 환불은 원 거래를 돌려받은 것, 돌려받음은 남이 대신 갚은 것이다(F-206). */
export type RefundKind = (typeof refundKinds)[number]

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

/** 서버가 저장한 거래의 모양인지. 쓰기 응답(transactionWrites.ts)도 이것으로 본다. */
export function isSavedTransaction(value: unknown): value is SavedTransaction {
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

export function isPerson(value: unknown): value is Person {
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
  /**
   * 환불·돌려받음이면 그 구분. 지출에만 있고 금액은 양수다. 일반 지출과 수입은 null이다. 이 칸이 생기기 전에 받아 기기에 남긴
   * 사본에는 없고, 없으면 환불이 아니다.
   */
  refundKind?: RefundKind | null
}

export interface ListedTransfer extends ListedBase {
  type: 'TRANSFER'
  fromAccountId: string
  toAccountId: string
}

export type ListedTransaction = ListedIncomeOrExpense | ListedTransfer

/**
 * 수입·지출 합계(P-205: 이체, 취소, 삭제를 뺀다). 원 단위 정수이고 지출도 양수로 센다. 환불·돌려받음이 더 큰 날과 달은
 * 음수다(서버 #8, #102). 화면은 음수를 "-"와 본문 글자색으로 보인다(00-common 2.2, totalKind).
 */
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

/**
 * 장부의 한 달 합계(P-205). 그 달의 첫 쪽을 한 건만 받아 합계(totals)만 쓴다(홈의 이번 달 합계, F-111).
 * `sender`는 request와 같다(여러 요청을 한 사용자의 토큰으로만 보낼 때). 실패하면 ApiError를 던진다.
 */
export async function fetchMonthTotals(ledgerId: string, month: string, sender?: SenderCheck): Promise<IncomeAndExpense> {
  const query = new URLSearchParams({ month, limit: '1' })
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'transactions')}?${query}`, {}, sender)
  if (!isTransactionPage(body, { month }, true)) throw ApiError.unreadable()
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

/** 장부 전체의 한 쪽. 합계(totals)가 없다. */
export type LedgerPage = Omit<TransactionPage, 'totals'>

/** 목록의 범위(#15): 한 달, 하루, 없으면(null) 장부 전체 */
type PageScope = { month: string } | { date: string } | null

/**
 * 한 쪽의 모양이 약속(#15)과 같은지. 거래와 그날 합계의 날짜가 모두 범위 안이어야 한다. 장부 전체(null)의 쪽은 합계가 없고
 * 날짜를 보지 않는다. 달과 하루의 첫 쪽에는 범위의 합계가 있다.
 */
export function isTransactionPage(value: unknown, scope: PageScope, first: boolean): value is TransactionPage {
  if (typeof value !== 'object' || value === null) return false
  const { items, nextCursor, totals, days } = value as Partial<Record<keyof TransactionPage, unknown>>
  if (!Array.isArray(items) || !Array.isArray(days)) return false
  const inScope = (date: string) =>
    scope === null || ('month' in scope ? monthOf(date) === scope.month : date === scope.date)
  if (!items.every((item) => isListedTransaction(item) && inScope(item.occurredOn))) return false
  if (!days.every((day) => isDayTotal(day) && inScope(day.date))) return false
  const dates = new Set(days.map(({ date }) => date))
  const totalsKept = scope === null ? totals === null : isIncomeAndExpense(totals) || (!first && totals === null)
  return (
    items.every(({ occurredOn }) => dates.has(occurredOn)) &&
    (nextCursor === null || (typeof nextCursor === 'string' && nextCursor !== '')) &&
    totalsKept
  )
}

/** 목록의 거래 하나가 약속(#15)대로인지. 기기에 남긴 사본도 이것으로 다시 본다(값은 믿지 않는다). */
export function isListedTransaction(value: unknown): value is ListedTransaction {
  if (!isSavedTransaction(value)) return false
  const body = value as Partial<Record<keyof ListedIncomeOrExpense | keyof ListedTransfer, unknown>>
  const shared =
    isUuid(body.id) &&
    typeof body.occurredOn === 'string' &&
    isDate(body.occurredOn) &&
    (body.occurredTime === null || (typeof body.occurredTime === 'string' && isValidTime(body.occurredTime))) &&
    Number.isSafeInteger(body.amount) &&
    (body.amount as number) >= 1
  // 환불 구분은 지출에만 있다(PR #397). 모르는 구분은 받지 않는다
  const refundKind = (value as { refundKind?: unknown }).refundKind
  const refundKept =
    refundKind === undefined ||
    refundKind === null ||
    (body.type === 'EXPENSE' && refundKinds.some((kind) => kind === refundKind))
  if (!shared || !refundKept) return false
  if (body.type === 'TRANSFER') return typeof body.fromAccountId === 'string' && typeof body.toAccountId === 'string'
  return (
    typeof body.accountId === 'string' &&
    typeof body.categoryId === 'string' &&
    (body.payee === null || typeof body.payee === 'string')
  )
}

/** 합계의 모양. 음수도 받는다(#390). 정수가 아니거나 안전한 정수 범위 밖이면 받지 않는다. */
export function isIncomeAndExpense(value: unknown): value is IncomeAndExpense {
  if (typeof value !== 'object' || value === null) return false
  const { income, expense } = value as Partial<Record<keyof IncomeAndExpense, unknown>>
  return [income, expense].every((amount) => Number.isSafeInteger(amount))
}

export function isDayTotal(value: unknown): value is DayTotal {
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
