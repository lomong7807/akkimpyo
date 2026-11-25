import { createContext } from 'react'

/** 지금 장부의 이름. 공통 틀(AppLayout)이 넘기고 상단 바가 그린다. 아직 받지 못했으면 없다. */
export const LedgerNameContext = createContext<string | undefined>(undefined)
