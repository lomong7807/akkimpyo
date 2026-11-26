import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerScope } from '../me/ledgerKey'
import { rememberLastAccount } from './lastAccount'
import { createTransaction, type NewTransaction } from './transactions'

export interface TransactionSave {
  transaction: NewTransaction
  /** 저장을 누른 때의 사용자. 보내는 순간의 사용자와 다르면 보내지 않는다. */
  user: string | undefined
}

/** 현재 장부에 거래를 만든다. 저장 하나는 요청 하나다. 다시 보내는 것은 사용자가 누른다. */
export function useCreateTransaction() {
  const ledger = useCurrentLedger()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ transaction, user }: TransactionSave) => createTransaction(ledger.id, transaction, user),
    onSuccess: (_, { transaction, user }) => {
      const account = transaction.type === 'TRANSFER' ? transaction.fromAccountId : transaction.accountId
      rememberLastAccount({ userId: user, ledgerId: ledger.id }, account)
      // 잔액, 거래, 통계가 함께 바뀐다. 다시 받기가 실패해도 따로 알리지 않는다(designer)
      void queryClient.invalidateQueries({ queryKey: ledgerScope(ledger.id) })
    },
  })
}
