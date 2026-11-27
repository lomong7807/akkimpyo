import { ApiError } from '../../api/apiError'
import { currentUserId } from '../../api/session'
import { pendingOf, readPending, settlePending, type Outcome, type PendingTransaction } from '../../device/pendingQueue'
import { markSent } from '../../device/markSent'
import { now } from '../../lib/clock'
import type { NewTransaction } from '../transactions/transactions'
import { createTransaction, needsResendNotice } from '../transactions/transactionWrites'
import { withQueueLock } from './queueLock'

/*
 * 쌓인 입력 보내기 한 번(F-105, F-107, ADR 006 결정 6, #235). 앱을 연 뒤 보내기 계기(useAutoSend)가 처음 부를 때 따로 받는다.
 * 보내기는 연결이 있을 때만 하므로 이 조각을 받을 수 있는 때이고, 받지 못해도 입력은 대기열에 그대로다(architect #235 A).
 * 보내지 않은 입력 목록(B-05)의 "지금 보내기"도 이것을 부른다(#236).
 *
 * - 토큰의 사용자가 쌓은 대기만 오래된 것부터 하나씩 보낸다. 줄마다 그 사용자가 지금 토큰의 sub와 같은지 다시 보고, 요청 계층도
 *   보낼 때마다(갱신해 다시 보낼 때 포함) 본다. 다르면 보내지도 지우지도 않고 멈춘다(security #79, architect #235 D)
 * - 다른 탭이 보내는 중이면 저절로 보내기는 건너뛰고, 지금 보내기는 끝나기를 기다린다(탭 사이 잠금, architect #235 B, queueLock)
 * - 줄마다 보내기 직전에 다시 읽고, 응답 뒤에는 그때 본 줄과 같을 때만 바꾼다(architect #235 C)
 */

/** 429에 Retry-After가 없거나 읽을 수 없을 때 기다리는 시간 */
const RETRY_AFTER_DEFAULT_MS = 60_000

/** 429의 기다림 상한. 큰 값을 받아도 이 탭이 오래 멈추지 않는다(architect #235 E) */
const RETRY_AFTER_MAX_MS = 15 * 60_000

/** 이 시각(밀리초)까지는 보내지 않는다(429). 이 탭에만 둔다 */
let pausedUntil = 0

export interface SendHandlers {
  /** 그 장부의 입력을 서버가 받았다(201, 200). 그 장부의 서버 데이터를 무효로 만든다 */
  onSent?: (ledgerId: string) => void
  /** 사용자가 누른 "지금 보내기"(F-107). 다른 탭이 보내는 중이면 끝나기를 기다렸다가 보낸다 */
  byUser?: boolean
  /**
   * 다른 탭이 보내는 중이면 건너뛰지 않고 놓을 때까지 기다린다. 기본은 byUser다. 고쳐서 보낸 뒤(F-108, #237)는 저절로 보내기처럼
   * 알리되(byUser 아님) 기다린다. 건너뛰면 그 탭은 이미 보낼 목록을 잡아 고친 줄을 다음 계기까지 보내지 않는다(architect #237)
   */
  wait?: boolean
}

/**
 * 대기로 남은 입력이 있는 까닭. connection은 보내던 중 연결이 끊김(다시 연결되면 저절로 보낸다), trouble은 서버 오류(5xx)·응답
 * 지연·429·다른 탭이 잠금을 놓지 않음·기기 저장소를 쓸 수 없음처럼 잠시 뒤에 다시 보낼 것이다(B-05 (2), P-226).
 */
export type SendStop = 'connection' | 'trouble'

export interface SendResult {
  /** 200이고 '이미 저장된 거래라 저장된 내용으로 두었다'를 알릴 건수(ADR 006 결정 3) */
  noticed: number
  /** 서버가 받은 건수(201, 200) */
  sent: number
  /** 이번에 서버가 이유를 붙여 거부해 보낼 수 없음이 된 건수 */
  rejected: number
  /** 이번에 보낼 차례였지만 보내지 못하고 대기로 남은 건수 */
  unsent: number
  /** 대기로 남은 입력이 있으면 그 까닭. 연결이 끊긴 것이 앞선다 */
  stopped?: SendStop
}

/** 보내기 한 번이 끝날 때마다(실제로 보내 본 때만) 부른다. 다른 탭이 보내는 중이라 건너뛴 때는 부르지 않는다 */
type FinishedListener = (result: SendResult, byUser: boolean) => void

const finishedListeners = new Set<FinishedListener>()

/** 이 탭의 보내기가 끝날 때마다 부른다(B-05가 결과 문구와 화면 읽기 알림에 쓴다). 돌려받은 함수로 끊는다 */
export function onSendFinished(listener: FinishedListener): () => void {
  finishedListeners.add(listener)
  return () => void finishedListeners.delete(listener)
}

/** 한 줄을 보낸 뒤 할 일 */
interface Step {
  sent?: true
  notice?: boolean
  rejected?: true
  /** 대기로 남았다 */
  kept?: SendStop
  /** 남은 줄을 이번에 보내지 않는다 */
  stop?: true
}

/** 대기인 입력을 오래된 것부터 보낸다. 실패해도 던지지 않는다. */
export async function sendQueue({ onSent, byUser = false, wait = byUser }: SendHandlers = {}): Promise<SendResult> {
  const userId = currentUserId()
  const result: SendResult = { noticed: 0, sent: 0, rejected: 0, unsent: 0 }
  // 확인하지 못한 로그인(토큰 없음)이면 보내지 않는다. 확인된 뒤의 계기에 보낸다
  if (userId === undefined || now() < pausedUntil) {
    if (!byUser) return result
    return finished({ ...result, stopped: 'trouble' }, byUser)
  }
  let attempted: boolean
  try {
    attempted = await withQueueLock(
      async () => {
        const waiting = (await pendingOf(userId)).filter(({ state }) => state.kind === 'waiting')
        for (const [index, { id }] of waiting.entries()) {
          if (currentUserId() !== userId) return
          if (now() < pausedUntil) return keep(result, 'trouble', waiting.length - index)
          const seen = await readPending(userId, id)
          if (seen?.state.kind !== 'waiting') continue
          const step = await sendOne(seen)
          if (step.notice) result.noticed += 1
          if (step.sent) {
            result.sent += 1
            onSent?.(seen.ledgerId)
          }
          if (step.rejected) result.rejected += 1
          // 멈추면 이 줄과 뒤에 남은 줄이 모두 대기로 남는다
          if (step.kept) keep(result, step.kept, step.stop ? waiting.length - index : 1)
          if (step.stop) return
        }
      },
      { wait },
    )
  } catch {
    // 기기 저장소를 쓸 수 없거나 다른 탭이 잠금을 놓지 않았다. 대기열은 그대로이고 다음 계기에 다시 본다
    attempted = true
    result.stopped ??= 'trouble'
  }
  return attempted ? finished(result, byUser) : result
}

/** `count`건이 `why`로 대기로 남았다. 연결이 끊긴 까닭이 서버 오류보다 앞선다 */
function keep(result: SendResult, why: SendStop, count: number): void {
  result.unsent += count
  if (result.stopped !== 'connection') result.stopped = why
}

function finished(result: SendResult, byUser: boolean): SendResult {
  for (const listener of finishedListeners) listener(result, byUser)
  return result
}

async function sendOne(seen: PendingTransaction): Promise<Step> {
  try {
    // 화면이 쌓을 때 만든 거래 만들기 본문(pendingTransactions)이다. 모양은 서버가 검증한다
    const body = seen.body as unknown as NewTransaction
    const result = await createTransaction(seen.ledgerId, body, seen.userId)
    await settle(seen, { kind: 'sent' })
    await markSent(seen.userId, now()).catch(() => {})
    return { sent: true, notice: needsResendNotice(result) }
  } catch (error) {
    return failed(seen, error)
  }
}

/**
 * ADR 006 결정 6의 표. problem+json이고 code가 있는 4xx(401, 429 빼고)만 보낼 수 없음이다. 그 밖은 모두 대기로 남는다.
 * 연결 오류와 429는 남은 줄도 이번에 보내지 않는다. 401은 요청 계층이 갱신해 한 번 다시 보낸 뒤의 결과다. 갱신이 401이면
 * 로그인이 끝나 다음 줄 앞에서 멈춘다.
 */
async function failed(seen: PendingTransaction, error: unknown): Promise<Step> {
  if (!(error instanceof ApiError)) return { kept: 'trouble', stop: true }
  if (isRefusal(error)) {
    await settle(seen, rejectionOf(error))
    return { rejected: true }
  }
  if (error.status === 429) {
    pausedUntil = now() + Math.min(error.retryAfterMs ?? RETRY_AFTER_DEFAULT_MS, RETRY_AFTER_MAX_MS)
    return { kept: 'trouble', stop: true }
  }
  return error.kind === 'connection' ? { kept: 'connection', stop: true } : { kept: 'trouble' }
}

/** 서버가 이유(code)를 붙여 거부했다. 본문을 읽을 수 없는 응답(프록시가 낸 4xx 등)은 아니다(code가 없다) */
function isRefusal(error: ApiError): error is ApiError & { status: number; code: string } {
  return error.kind === 'rejected' && error.code !== undefined && error.status !== 401 && error.status !== 429
}

function rejectionOf(error: ApiError & { status: number; code: string }): Outcome {
  const { status, code, fieldErrors, current } = error
  const rejection: Extract<Outcome, { kind: 'rejected' }> = { kind: 'rejected', status, code, fieldErrors, at: now() }
  // 선택 화면(#280)이 쓰도록 같은 id로 저장된 내 거래를 남긴다
  if (code === 'ID_CONFLICT' && current !== undefined) rejection.current = current
  return rejection
}

/** 줄을 바꾸지 못해도(저장소를 쓸 수 없음) 보내기는 이어 간다. 줄은 대기로 남아 다음에 다시 보낸다 */
async function settle(seen: PendingTransaction, outcome: Outcome): Promise<void> {
  await settlePending(seen, outcome).catch(() => false)
}
