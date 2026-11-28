import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { isDuplicateName } from './accountRejection'
import { createAccount, type Account, type NewAccount } from './accounts'
import { accountsKey } from './useAccounts'

/**
 * 현재 장부에 계좌를 추가한다. 같은 이름으로 거부되면 목록을 무효로 만든다. 응답을 잃고 다시 보낸 경우면 앞 요청이 이미 저장된
 * 것일 수 있어, 닫고 목록으로 돌아가면 그 계좌가 보이게 한다(planner #243 P1). 문구는 그대로다.
 */
export function useCreateAccount() {
  const ledger = useCurrentLedger()
  const queryClient = useQueryClient()
  const queryKey = accountsKey(ledger.id)
  return useMutation({
    mutationFn: (account: NewAccount) => createAccount(ledger.id, account),
    onSuccess: (created) => {
      // 저장하기 전에 보낸 목록 요청의 답은 쓰지 않는다
      void queryClient.cancelQueries({ queryKey })
      // 목록을 다시 받는 동안에도 새 계좌가 보이게 한다. 서버는 만든 순서로 준다
      queryClient.setQueryData<Account[]>(queryKey, (accounts) => accounts && [...accounts, created])
      void queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => {
      if (isDuplicateName(error)) void queryClient.invalidateQueries({ queryKey })
    },
  })
}
