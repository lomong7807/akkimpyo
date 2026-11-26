import { useQuery } from '@tanstack/react-query'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { fetchKeepingCopy } from '../me/ledgerCopy'
import { ledgerKey, LEDGER_LIST } from '../me/ledgerKey'
import { fetchCategories } from './categories'

/** 현재 장부의 카테고리. 받을 때마다 기기 사본으로 남긴다(#234). */
export function useCategories() {
  const ledger = useCurrentLedger()
  return useQuery({
    queryKey: ledgerKey(ledger.id, 'categories'),
    queryFn: () => fetchKeepingCopy(ledger.id, 'categories', () => fetchCategories(ledger.id)),
    meta: LEDGER_LIST,
  })
}
