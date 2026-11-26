import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ApiError } from '../../api/apiError'
import { sessionUserId } from '../../api/session'
import { pendingOf, queueTransaction, type PendingTransaction } from '../../device/pendingQueue'
import { isDate } from '../../lib/calendarDate'
import { now } from '../../lib/clock'
import { isValidTime } from '../../lib/timeText'
import type { Category } from '../categories/categories'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { deviceKey } from '../me/deviceKey'
import { rememberLastAccount } from './lastAccount'
import type { DayTotal, IncomeAndExpense, ListedTransaction, NewTransaction } from './transactions'

/*
 * 연결이 없을 때의 새 거래 저장(F-103, P-225, P-904, #234 B). 새 거래 입력(D-04)과 한 줄 입력 결과 확인(D-05, #233)이 쓴다.
 * 수정과 삭제는 쌓지 않는다(ADR 006 결정 2).
 */

/** 기기에 쌓은 새 거래의 토스트(F-103) */
export const QUEUED_TOAST = '기기에 저장했어요. 연결되면 보낼게요.'

/** 기기에 쌓지 못했을 때의 문구(designer Q8). 연결이 없는 동안 "다시 시도"는 비활성이다 */
export const QUEUE_FAILED = '연결이 없어 저장하지 못했어요. 이 브라우저에는 저장해 둘 수 없어요.'

/** 요청이 응답 없이 실패했다(요청 중 연결이 끊김). 이 새 거래는 같은 id로 쌓는다(P-904). 서버 오류와 지연은 아니다 */
export function isConnectionLoss(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'connection'
}

interface Owner {
  /** 입력의 주인(sessionUserId). 확인하지 못한 로그인이면 기록의 사용자다 */
  userId: string | undefined
  ledgerId: string
}

/**
 * 새 거래를 대기열에 쌓는다. 로그인 확인 없이 되고, 보낼 때 인증한다(D-04 예외 처리). 쌓으면 그 계좌를 마지막으로 쓴 계좌로
 * 남긴다(F-102, planner Q7). 쌓지 못하면(저장소를 쓸 수 없음, 주인을 모름) 던진다.
 */
export async function queueNewTransaction({ userId, ledgerId }: Owner, transaction: NewTransaction): Promise<void> {
  if (userId === undefined) throw new Error('입력의 주인을 모른다')
  await queueTransaction({ userId, ledgerId, body: { ...transaction }, queuedAt: now() })
  const account = transaction.type === 'TRANSFER' ? transaction.fromAccountId : transaction.accountId
  rememberLastAccount({ userId, ledgerId }, account)
}

/*
 * 쌓은 거래의 "보내지 않음" 줄(C-01 (9)(10), D-01 (4)(8)(11)). 서버 거래와 같은 순서 규칙으로 섞는다. 내역 합계와 날짜 묶음
 * 머리의 그날 합계에는 더하고(planner Q5), 홈의 이번 달 합계와 계좌 잔액에는 더하지 않는다(작성자 판단 43).
 * 대기(waiting)만 보인다. 보낼 수 없음의 줄과 칩은 #235가 더한다.
 */

/** 목록에 보이는 거래. 기기에 쌓여 아직 서버에 없는 줄은 pending이다(눌리지 않는다, 1B 임시 #236) */
export type ShownTransaction = ListedTransaction & { pending?: true }

/** 대기열 조회의 캐시 키. 대기열이 바뀌면(이 탭, 다른 탭) 로그인 영역(SignedInArea)이 이것을 무효로 만든다. */
export function pendingKey(userId: string | undefined) {
  return deviceKey(userId, 'pending')
}

/** 이 탭의 기기 데이터 주인이 이 장부에 쌓은 대기 항목 */
export function usePendingTransactions(): PendingTransaction[] {
  const ledger = useCurrentLedger()
  const user = sessionUserId()
  const query = useQuery({
    queryKey: pendingKey(user),
    queryFn: () => pendingOf(user!),
    enabled: user !== undefined,
    staleTime: Infinity,
  })
  return useMemo(
    () => (query.data ?? []).filter(({ ledgerId, state }) => ledgerId === ledger.id && state.kind === 'waiting'),
    [query.data, ledger.id],
  )
}

/** 대기 항목을 목록의 줄로 바꾼다. 비운 카테고리는 그 장부의 미분류다. 본문이 약속과 다르면 없다. */
export function pendingRow({ body }: PendingTransaction, categories: Category[]): ShownTransaction | undefined {
  const { id, type, occurredOn, occurredTime, amount } = body
  const timeOk = occurredTime === null || (typeof occurredTime === 'string' && isValidTime(occurredTime))
  if (typeof occurredOn !== 'string' || !isDate(occurredOn) || !timeOk || !Number.isSafeInteger(amount)) return undefined
  if ((amount as number) < 1) return undefined
  const shared = {
    id,
    status: 'POSTED' as const,
    version: 1,
    deletedAt: null,
    occurredOn,
    occurredTime: occurredTime as string | null,
    amount: amount as number,
    pending: true as const,
  }
  if (type === 'TRANSFER') {
    const { fromAccountId, toAccountId } = body
    if (typeof fromAccountId !== 'string' || typeof toAccountId !== 'string') return undefined
    return { ...shared, type, fromAccountId, toAccountId }
  }
  const { accountId, categoryId, payee } = body
  if (typeof accountId !== 'string' || (payee !== null && typeof payee !== 'string')) return undefined
  const uncategorized = categories.find((category) => category.system && category.kind === type)?.id ?? ''
  const category = typeof categoryId === 'string' ? categoryId : uncategorized
  return { ...shared, type, accountId, categoryId: category, payee }
}

/**
 * 서버 목록의 순서(#15, D-01 (8)): 날짜 역순, 같은 날은 시각 있는 것이 먼저 시각 역순, 같으면 id 역순.
 * 거래 id가 만든 순서대로 커지는 UUID v7이라 시각 없는 거래는 입력한 순서의 역순이 된다.
 */
export function compareListed(a: ListedTransaction, b: ListedTransaction): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1
  if ((a.occurredTime === null) !== (b.occurredTime === null)) return a.occurredTime === null ? 1 : -1
  if (a.occurredTime !== null && b.occurredTime !== null && a.occurredTime !== b.occurredTime) {
    return a.occurredTime < b.occurredTime ? 1 : -1
  }
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** 서버 줄에 같은 id가 있는 대기 항목은 뺀다(요청 중 끊겼지만 서버에는 저장된 경우). 서버 줄이 기준이다. */
function notOnServer(pending: ShownTransaction[], items: ListedTransaction[]): ShownTransaction[] {
  const ids = new Set(items.map(({ id }) => id.toLowerCase()))
  return pending.filter(({ id }) => !ids.has(id.toLowerCase()))
}

/**
 * 내역의 한 달: 그 달의 대기 항목을 섞는다. 다음 쪽이 남았으면(`complete`가 아니면) 받은 마지막 서버 줄보다 앞에 오는 것만
 * 넣는다. 쪽을 받을 때 줄 순서가 뒤집히지 않게 하기 위해서다.
 */
export function mergeMonth(
  items: ListedTransaction[],
  pending: ShownTransaction[],
  complete: boolean,
): ShownTransaction[] {
  const last = items.at(-1)
  const shown = notOnServer(pending, items).filter((row) => complete || !last || compareListed(row, last) < 0)
  return insertInOrder(items, shown)
}

/** 홈 최근 거래: 오늘까지의 대기 항목을 섞어 위에서 `limit`건(planner Q6). 서버도 오늘까지만 준다. */
export function mergeRecent(
  items: ListedTransaction[],
  pending: ShownTransaction[],
  today: string,
  limit: number,
): ShownTransaction[] {
  const shown = notOnServer(pending, items).filter(({ occurredOn }) => occurredOn <= today)
  return insertInOrder(items, shown).slice(0, limit)
}

/**
 * 서버 줄의 순서는 그대로 두고(다시 정렬하지 않는다) 대기 줄을 그 순서 규칙의 자리에 끼운다. 대기 줄은 처음으로 자기보다 뒤에
 * 오는 서버 줄 바로 앞에 놓는다.
 */
function insertInOrder(items: ShownTransaction[], rows: ShownTransaction[]): ShownTransaction[] {
  const merged = [...items]
  for (const row of [...rows].sort(compareListed)) {
    const at = merged.findIndex((item) => !item.pending && compareListed(row, item) < 0)
    if (at === -1) merged.push(row)
    else merged.splice(at, 0, row)
  }
  return merged
}

/** 대기 항목의 수입·지출(P-205: 이체는 뺀다) */
export function pendingSums(rows: ShownTransaction[]): IncomeAndExpense {
  const sum = (type: string) => rows.filter((row) => row.type === type).reduce((total, row) => total + row.amount, 0)
  return { income: sum('INCOME'), expense: sum('EXPENSE') }
}

/** 날짜 묶음 머리의 그날 합계에 보이는 대기 줄을 더한다(planner Q5). 대기 줄만 있는 날도 머리 합계가 생긴다. */
export function withPendingDays(days: Map<string, DayTotal>, rows: ShownTransaction[]): Map<string, DayTotal> {
  const pending = rows.filter((row) => row.pending)
  if (pending.length === 0) return days
  const added = new Map(days)
  for (const date of new Set(pending.map(({ occurredOn }) => occurredOn))) {
    const sums = pendingSums(pending.filter(({ occurredOn }) => occurredOn === date))
    const day = added.get(date) ?? { date, income: 0, expense: 0 }
    added.set(date, { date, income: day.income + sums.income, expense: day.expense + sums.expense })
  }
  return added
}
