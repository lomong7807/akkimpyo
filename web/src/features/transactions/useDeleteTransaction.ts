import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ApiError } from '../../api/apiError'
import { currentUserId } from '../../api/session'
import { useToast } from '../../components/ToastContext'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerScope } from '../me/ledgerKey'
import {
  deleteTransaction,
  isInvalidState,
  restoreTransaction,
  staleVersionOf,
  type SavedTransaction,
} from './transactions'
import { transactionKey } from './useTransactionDetail'

/** 되돌리기가 실패했을 때의 토스트(planner 결정 2026-11-26, 1A에는 휴지통 화면이 없어 "휴지통에서 복원" 안내를 뺀다) */
const UNDO_FAILED = '되돌리지 못했어요'

export interface TransactionDeletion {
  /** 화면이 본 거래의 version */
  version: number
  /** 화면을 연 사용자. 보내는 순간의 사용자와 다르면 보내지 않는다. */
  user: string | undefined
}

/**
 * 현재 장부의 거래 하나를 휴지통으로 옮긴다(F-227). 삭제 하나는 요청 하나다. 다시 보내는 것은 사용자가 누른다.
 * - 성공: 잔액, 거래, 통계가 함께 바뀌므로 장부 앞부분을 무효로 만든다. 지금 보는 상세는 곧 떠나므로 다시 받지 않고,
 *   돌아간 화면이 그릴 때 다시 받는다.
 * - 낡은 version(409 STALE_VERSION): 응답의 최신 거래로 상세를 바꾼다. 휴지통에 있으면 deletedAt이 차 있다.
 * - 상태가 맞지 않음(409 INVALID_STATE): 상세를 다시 받는다.
 */
export function useDeleteTransaction(id: string) {
  const ledger = useCurrentLedger()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ version, user }: TransactionDeletion) => deleteTransaction(ledger.id, id, version, user),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ledgerScope(ledger.id), refetchType: 'none' })
    },
    onError: (error) => {
      const stale = staleVersionOf(error, id)
      if (stale?.current) {
        void queryClient.invalidateQueries({ queryKey: ledgerScope(ledger.id), refetchType: 'none' })
        queryClient.setQueryData(transactionKey(ledger.id, id), stale.current)
      } else if (stale || isInvalidState(error)) {
        void queryClient.invalidateQueries({ queryKey: ledgerScope(ledger.id) })
      }
    },
  })
}

/**
 * 삭제한 거래의 토스트 "휴지통으로 옮겼어요"와 "되돌리기"(F-227, 00-common 5.7)를 보이는 함수.
 * 되돌리기는 삭제 응답의 version으로 복원한다(F-230). 결과는 셋으로 나눈다(architect 결정 2026-11-26, #102).
 * - 성공, 또는 409의 최신 거래(current)가 휴지통에 없음(다른 기기가 이미 되돌림): "되돌렸어요"와 장부 무효화
 * - 연결 문제, 지연, 서버 오류(5xx), 읽을 수 없는 응답: "되돌리지 못했어요"와 같은 복원을 다시 보내는 "다시 시도"
 * - 그 밖의 거부(아직 휴지통에 있는 충돌, INVALID_STATE, 404 등): 다시 보내도 같으므로 "되돌리지 못했어요"만
 * 토스트는 상세를 떠난 뒤에도 남으므로 화면의 상태를 쓰지 않는다. 로그인이 끝나면 토스트와 캐시가 함께 버려지고,
 * 그 뒤에 온 응답은 쓰지 않는다.
 */
export function useOfferUndo() {
  const ledger = useCurrentLedger()
  const queryClient = useQueryClient()
  const showToast = useToast()
  return useCallback(
    (deleted: SavedTransaction, user: string | undefined) => {
      let sending = false
      function restore() {
        if (sending) return
        sending = true
        function restored() {
          void queryClient.invalidateQueries({ queryKey: ledgerScope(ledger.id) })
          showToast('되돌렸어요')
        }
        restoreTransaction(ledger.id, deleted.id, deleted.version, user).then(
          () => {
            if (currentUserId() === user) restored()
          },
          (error: unknown) => {
            sending = false
            if (currentUserId() !== user) return
            const current = staleVersionOf(error, deleted.id)?.current
            if (current && current.deletedAt === null) restored()
            else if (isTemporary(error)) showToast(UNDO_FAILED, { label: '다시 시도', onAction: restore })
            else showToast(UNDO_FAILED)
          },
        )
      }
      showToast('휴지통으로 옮겼어요', { label: '되돌리기', onAction: restore })
    },
    [ledger.id, queryClient, showToast],
  )
}

/**
 * 다시 보내면 될 수 있는 실패: 연결 문제, 지연, 서버 오류(5xx), 읽을 수 없는 응답(200인데 본문이 약속과 다름).
 * 읽을 수 없는 응답은 서버에서 되돌려졌을 수 있다. 다시 보내면 409의 current로 돌아와 "되돌렸어요"로 맞춰진다
 * (architect 권고 #88).
 */
function isTemporary(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.kind === 'connection' || error.kind === 'timeout' || error.kind === 'server'
}
