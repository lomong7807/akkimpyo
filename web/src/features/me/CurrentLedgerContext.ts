import { createContext, use } from 'react'
import type { Ledger } from './me'

export const CurrentLedgerContext = createContext<Ledger | undefined>(undefined)

/** 현재 장부. 로그인한 사람의 화면에서만 쓴다. */
export function useCurrentLedger(): Ledger {
  const ledger = use(CurrentLedgerContext)
  if (!ledger) throw new Error('로그인한 사람의 화면에서만 쓴다')
  return ledger
}
