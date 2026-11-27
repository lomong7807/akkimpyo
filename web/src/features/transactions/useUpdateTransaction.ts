import { useMutation, useQueryClient } from '@tanstack/react-query'
import { currentUserId } from '../../api/session'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerScope } from '../me/ledgerKey'
import { isInvalidState, isNotFound, staleVersionOf, updateTransaction, type TransactionUpdate } from './transactions'
import { transactionKey } from './useTransactionDetail'

export interface TransactionEdit {
  update: TransactionUpdate
  /** 수정 화면을 연 사용자. 보내는 순간의 사용자와 다르면 보내지 않는다. */
  user: string | undefined
}

/**
 * 현재 장부의 거래 하나를 고친다(F-208). 저장 하나는 요청 하나다. 다시 보내는 것은 사용자가 누른다.
 * 결과가 오면 캐시를 맞춘다. 로그아웃하거나 다른 사용자로 바뀐 뒤에 온 응답으로는 바꾸지 않는다.
 * - 성공: 잔액, 거래, 통계가 함께 바뀌므로 장부 앞부분을 무효로 만들고(돌아간 화면이 그릴 때 다시 받는다) 상세는 받은 거래로 둔다.
 * - 낡은 version(409 STALE_VERSION): 응답의 최신 거래가 있으면 상세를 그것으로 바꾼다. 없으면 상세를 다시 받게 한다.
 * - 휴지통에 있음(409 INVALID_STATE), 없음(404): 장부 앞부분을 다시 받는다(목록에서 빠진다).
 */
export function useUpdateTransaction(id: string) {
  const ledger = useCurrentLedger()
  const queryClient = useQueryClient()
  const key = transactionKey(ledger.id, id)
  return useMutation({
    mutationFn: ({ update, user }: TransactionEdit) => updateTransaction(ledger.id, id, update, user),
    onSuccess: (saved, { user }) => {
      if (currentUserId() !== user) return
      void queryClient.invalidateQueries({ queryKey: ledgerScope(ledger.id), refetchType: 'none' })
      queryClient.setQueryData(key, saved)
    },
    onError: (error, { user }) => {
      if (currentUserId() !== user) return
      const stale = staleVersionOf(error, id)
      if (stale) {
        void queryClient.invalidateQueries({ queryKey: ledgerScope(ledger.id), refetchType: 'none' })
        if (stale.current) queryClient.setQueryData(key, stale.current)
      } else if (isInvalidState(error) || isNotFound(error)) {
        void queryClient.invalidateQueries({ queryKey: ledgerScope(ledger.id) })
      }
    },
  })
}
