import { useQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { fetchCategories } from './categories'

/** 현재 장부의 카테고리. 카테고리를 바꾸는 화면은 저장한 뒤 다시 받게 한다. */
export function useCategories() {
  const ledger = useCurrentLedger()
  return useQuery({ queryKey: ['ledgers', ledger.id, 'categories'], queryFn: () => fetchCategories(ledger.id) })
}
