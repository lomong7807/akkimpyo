import { ApiError } from '../../api/apiError'
import { connection } from '../../api/connection'
import {
  isSameRow,
  readPending,
  refilePending,
  settlePending,
  type PendingBody,
  type PendingTransaction,
  type Rejection,
} from '../../device/pendingQueue'
import { withQueueLock } from '../sync/queueLock'
import { isRefusal, rejectionOf } from '../sync/sendQueue'
import type { ChoiceLists } from '../transactions/choiceLists'
import { KEPT_TOAST, RESEND_NOTICE, SAVE_FAILED, SAVE_LOST } from '../transactions/IdConflictChoice'
import { isConnectionLoss } from '../transactions/pendingTransactions'
import { isSameId, isTransactionDetail } from '../transactions/transactionDetail'
import {
  hasSameContent,
  toNewTransaction,
  toTransactionUpdate,
  type TransactionValues,
} from '../transactions/transactionForm'
import type { TransactionDetail } from '../transactions/transactions'
import { createTransaction, needsResendNotice, staleVersionOf, updateTransaction } from '../transactions/transactionWrites'
import { pendingValuesOf } from './fixOpening'

/*
 * B-05 보낼 수 없음 줄의 "비교해서 고르기"(#280, ADR 006 결정 3). current가 있는 409 ID_CONFLICT로 보낼 수 없음이 된 줄에서
 * #239의 선택 판(IdConflictChoice)으로 고른 뒤의 일이다. 문구·모양은 designer #280 D1~D6, 범위는 planner #280 P1·P2다.
 *
 * - 세 선택 모두 보내기와 같은 탭 사이 잠금을 기다렸다가(사용자가 누른 동작, 15초) 판을 연 때 본 줄이 그대로일 때만 한다(#235).
 *   다른 탭이 그 줄을 먼저 버렸거나 골랐으면 서버에 보내지 않는다(D4). 두 탭이 같은 줄을 서로 다르게 고르는 일이 없다
 * - 요청은 줄을 쌓은 사용자로 보낸다. 요청 계층이 보내는 순간의 토큰 sub와 비교한다(#234)
 * - 줄은 응답 뒤에 그때 본 줄과 같을 때만 바꾼다(settlePending, refilePending)
 */

/** "저장된 내용 그대로"를 하지 못했다(기기 저장소를 쓸 수 없음, 다른 탭이 잠금을 놓지 않음, designer #280 D3) */
export const KEEP_FAILED = '문제가 생겨 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
/** "내 입력으로 고치기"·"새 거래로 저장"이 저장된 뒤(designer #280 D5, #239와 같다) */
export const SAVED = '저장했어요'

/** 판에 보일 줄. 그 장부의 목록, 읽을 수 있는 저장된 거래와 내 입력이 모두 있어야 고를 수 있다(planner #280 P2) */
export interface Choosable {
  current: TransactionDetail
  mine: TransactionValues
}

/** 그 줄에서 비교해서 고를 수 있으면 저장된 거래와 내 입력. current가 없거나 읽을 수 없거나 본문을 읽을 수 없으면 없다 */
export function choosableOf({ id, state, body }: PendingTransaction): Choosable | undefined {
  if (state.kind !== 'rejected' || state.code !== 'ID_CONFLICT') return undefined
  const { current } = state
  if (!isTransactionDetail(current) || !isSameId(current.id, id)) return undefined
  const mine = pendingValuesOf(body)
  return mine && { current, mine }
}

/** 고른 뒤의 일 */
export type ChoiceResult =
  /** 줄을 지웠다. 판을 닫고 토스트 */
  | { kind: 'removed'; toast: string }
  /** 판을 연 사이 다른 곳에서 그 줄이 바뀌었거나 없어졌다. 보내지 않았다(D4) */
  | { kind: 'changed' }
  /** 그사이 또 고쳐졌다(409 STALE_VERSION). 줄의 current를 그 내용으로 바꿨다. 판을 다시 그린다(D5) */
  | { kind: 'redraw'; seen: PendingTransaction; current: TransactionDetail }
  /** 서버가 칸·권한으로 거부했다. 그 줄(새 거래로 저장이면 새 id의 줄)을 그 거부의 보낼 수 없음으로 바꿨다(D1) */
  | { kind: 'refused'; id: string }
  /** 새 거래로 저장을 연결 없이 했다. 그 줄을 새 id의 대기로 바꿨다(D2) */
  | { kind: 'queued'; id: string }
  /** 판 안에 보일 실패. 줄은 그대로다 */
  | { kind: 'failed'; message: string }

/** "저장된 내용 그대로": 보내지 않고 그 줄을 지운다. 같은 id의 거래가 이미 서버에 있다 */
export function keepSaved(seen: PendingTransaction): Promise<ChoiceResult> {
  return whileHolding(seen, KEEP_FAILED, async () => {
    if (!(await settlePending(seen, { kind: 'sent' }))) return { kind: 'changed' }
    return { kind: 'removed', toast: KEPT_TOAST }
  })
}

/**
 * "내 입력으로 고치기": 저장된 거래의 version으로 내 입력을 PUT 한다(#36). 그사이 또 고쳐졌으면(409 STALE_VERSION) 그 내용이
 * 내 입력과 같으면 성공이고, 다르면 판을 그 내용으로 다시 그린다(#239와 같다, planner #239 P2).
 */
export function fixSaved(
  seen: PendingTransaction,
  current: TransactionDetail,
  mine: TransactionValues,
  lists: ChoiceLists,
): Promise<ChoiceResult> {
  return whileHolding(seen, SAVE_FAILED, async () => {
    try {
      await updateTransaction(seen.ledgerId, seen.id, toTransactionUpdate(mine, current.version), seen.userId)
    } catch (error) {
      const stale = staleVersionOf(error, seen.id)
      const latest = stale?.current
      if (latest && !(latest.deletedAt === null && hasSameContent(mine, lists.valuesOf(latest)))) {
        return redrawn(seen, latest)
      }
      if (!latest) {
        // current를 읽을 수 없는 STALE_VERSION은 거부 표로 바꾸지 않는다. 같은 id로 다시 보내면 또 같은 409다
        if (!stale && error instanceof ApiError && isRefusal(error)) return refused(seen, error)
        return { kind: 'failed', message: isConnectionLoss(error) ? SAVE_LOST : SAVE_FAILED }
      }
    }
    return removed(seen, SAVED)
  })
}

/**
 * 유형이 달라 고칠 수 없을 때(P-213)의 "새 거래로 저장": 새 id(`newId`, 다시 시도해도 같다)로 만든다. 먼저 저장된 거래는 그대로
 * 남는다. 연결이 없거나 요청 중에 끊기면 그 줄을 새 id의 대기로 바꿔 연결되면 보낸다(designer #280 D2).
 */
export function saveAsNew(seen: PendingTransaction, mine: TransactionValues, newId: string): Promise<ChoiceResult> {
  return whileHolding(seen, SAVE_FAILED, async () => {
    const transaction = toNewTransaction(mine, newId)
    const body: PendingBody = { ...transaction }
    if (connection() === 'offline') return queued(seen, body)
    let toast: string
    try {
      const result = await createTransaction(seen.ledgerId, transaction, seen.userId)
      toast = needsResendNotice(result) ? RESEND_NOTICE : SAVED
    } catch (error) {
      if (isConnectionLoss(error)) return queued(seen, body)
      if (error instanceof ApiError && isRefusal(error)) {
        const changed = await refilePending(seen, body, rejectionOf(error))
        return changed ? { kind: 'refused', id: newId } : { kind: 'changed' }
      }
      return { kind: 'failed', message: SAVE_FAILED }
    }
    return removed(seen, toast)
  })
}

/**
 * 탭 사이 잠금을 쥐고, 판을 연 때 본 줄이 그대로이면 `work`를 한다. 잠금을 15초 안에 얻지 못했거나 기기 저장소를 쓸 수 없으면
 * `troubled`의 실패다. 서버는 받았는데 줄을 지우지 못했으면 다시 시도가 같은 결과(200 또는 같은 내용의 STALE_VERSION)로 지운다.
 */
async function whileHolding(
  seen: PendingTransaction,
  troubled: string,
  work: () => Promise<ChoiceResult>,
): Promise<ChoiceResult> {
  let result: ChoiceResult = { kind: 'failed', message: troubled }
  try {
    await withQueueLock(
      async () => {
        const row = await readPending(seen.userId, seen.id)
        result = row && isSameRow(row, seen) ? await work() : { kind: 'changed' }
      },
      { wait: true },
    )
  } catch {
    return { kind: 'failed', message: troubled }
  }
  return result
}

async function removed(seen: PendingTransaction, toast: string): Promise<ChoiceResult> {
  // 판을 연 뒤 이 탭이 잠금을 쥐고 있어 줄은 그대로다. 잠금이 없는 브라우저에서 그사이 바뀌었어도 서버에는 저장됐다
  await settlePending(seen, { kind: 'sent' })
  return { kind: 'removed', toast }
}

async function redrawn(seen: PendingTransaction, latest: TransactionDetail): Promise<ChoiceResult> {
  if (seen.state.kind !== 'rejected') return { kind: 'changed' }
  const state: { kind: 'rejected' } & Rejection = { ...seen.state, current: latest }
  if (!(await settlePending(seen, state))) return { kind: 'changed' }
  return { kind: 'redraw', seen: { ...seen, state }, current: latest }
}

async function refused(seen: PendingTransaction, error: ApiError & { status: number; code: string }): Promise<ChoiceResult> {
  if (!(await settlePending(seen, rejectionOf(error)))) return { kind: 'changed' }
  return { kind: 'refused', id: seen.id }
}

async function queued(seen: PendingTransaction, body: PendingBody): Promise<ChoiceResult> {
  if (!(await refilePending(seen, body))) return { kind: 'changed' }
  return { kind: 'queued', id: body.id }
}
