import { useQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { fetchAccounts } from './accounts'

/** 잔액이 바뀌는 저장을 한 뒤에는 이 키를 무효로 만든다. */
export function accountsKey(ledgerId: string) {
  return ['ledgers', ledgerId, 'accounts'] as const
}

/** 현재 장부의 계좌 목록 */
export function useAccounts() {
  const ledger = useCurrentLedger()
  return useQuery({ queryKey: accountsKey(ledger.id), queryFn: () => fetchAccounts(ledger.id) })
}
