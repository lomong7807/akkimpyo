import { ApiError } from '../../api/apiError'
import { queueTransaction } from '../../device/pendingQueue'
import { now } from '../../lib/clock'
import { rememberLastAccount } from './lastAccount'
import type { NewTransaction } from './transactions'

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
