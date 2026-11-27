import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/apiError'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerScope } from '../me/ledgerKey'
import { isDuplicateName } from './accountRejection'
import { updateAccount } from './accountEdit'
import type { Account, NewAccount } from './accounts'
import { accountsKey } from './useAccounts'

/**
 * 현재 장부의 계좌 하나를 고친다(F-503). 저장 하나는 요청 하나이고 다시 보내는 것은 사용자가 누른다. 결과가 오면 캐시를 맞춘다.
 * - 성공: 목록을 다시 받는 동안에도 고친 계좌(서버가 다시 구한 잔액)가 보이게 목록 캐시의 그 줄을 바꾼다. 이름과 잔액은 홈, 내역,
 *   통계에도 보이므로 장부 앞부분을 무효로 만든다(돌아간 화면이 그릴 때 다시 받는다).
 * - 그사이 지워짐(404), 같은 이름(DUPLICATE): 목록이 낡았으므로 목록을 다시 받는다(planner #243 P1).
 */
export function useUpdateAccount(id: string) {
  const ledger = useCurrentLedger()
  const queryClient = useQueryClient()
  const queryKey = accountsKey(ledger.id)
  return useMutation({
    mutationFn: (account: NewAccount) => updateAccount(ledger.id, id, account),
    onSuccess: (saved) => {
      // 저장하기 전에 보낸 목록 요청의 답은 쓰지 않는다
      void queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<Account[]>(queryKey, (accounts) =>
        accounts?.map((account) => (account.id === saved.id ? saved : account)),
      )
      void queryClient.invalidateQueries({ queryKey: ledgerScope(ledger.id) })
    },
    onError: (error) => {
      if (isGone(error) || isDuplicateName(error)) void queryClient.invalidateQueries({ queryKey })
    },
  })
}

/** 고칠 계좌가 그 장부에 없다(그사이 지워짐, P-903). 서버는 다른 장부의 계좌와 가르지 않는다 */
export function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}
