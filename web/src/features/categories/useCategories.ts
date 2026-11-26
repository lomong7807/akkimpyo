import { queryOptions, useQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { fetchKeepingCopy } from '../me/ledgerCopy'
import { ledgerKey, LEDGER_LIST } from '../me/ledgerKey'
import { fetchCategories } from './categories'

/** 장부의 카테고리를 받는 법. 받을 때마다 기기 사본으로 남긴다(#234). */
export function categoriesQuery(ledgerId: string) {
  return queryOptions({
    queryKey: ledgerKey(ledgerId, 'categories'),
    queryFn: () => fetchKeepingCopy(ledgerId, 'categories', () => fetchCategories(ledgerId)),
    meta: LEDGER_LIST,
  })
}

/** 현재 장부의 카테고리 */
export function useCategories() {
  const ledger = useCurrentLedger()
  return useQuery(categoriesQuery(ledger.id))
}
