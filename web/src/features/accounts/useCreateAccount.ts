import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { createAccount, type Account, type NewAccount } from './accounts'
import { accountsKey } from './useAccounts'

/** 현재 장부에 계좌를 추가한다. */
export function useCreateAccount() {
  const ledger = useCurrentLedger()
  const queryClient = useQueryClient()
  const queryKey = accountsKey(ledger.id)
  return useMutation({
    mutationFn: (account: NewAccount) => createAccount(ledger.id, account),
    onSuccess: (created) => {
      // 목록을 다시 받는 동안에도 새 계좌가 보이게 한다. 서버는 만든 순서로 준다
      queryClient.setQueryData<Account[]>(queryKey, (accounts) => accounts && [...accounts, created])
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}
