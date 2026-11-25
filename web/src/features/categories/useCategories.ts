import { useQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerKey } from '../me/ledgerKey'
import { fetchCategories } from './categories'

/** 현재 장부의 카테고리 */
export function useCategories() {
  const ledger = useCurrentLedger()
  return useQuery({ queryKey: ledgerKey(ledger.id, 'categories'), queryFn: () => fetchCategories(ledger.id) })
}
