import { createContext, use } from 'react'

/**
 * 통계(E 그룹)가 로그인 한 번 동안 기억하는 것(E 공통의 기간 규칙, F-311). 메모리에만 있고 기기 저장소에 남기지 않는다.
 * 앱의 로그인한 영역이 로그인마다 새로 만들므로 로그아웃하면 사라진다(내역의 listMemory와 같다).
 * 1C의 연 통계(E-05, E-06)가 오면 고른 해를 여기에 더한다.
 */
export interface StatsMemory {
  /** 월 통계에서 마지막으로 본 달. 주소에 달이 없을 때 연다. */
  month(): string | undefined
  rememberMonth(month: string): void
}

export function createStatsMemory(): StatsMemory {
  let month: string | undefined
  return {
    month: () => month,
    rememberMonth(next) {
      month = next
    },
  }
}

export const StatsMemoryContext = createContext<StatsMemory | undefined>(undefined)

/** 로그인한 사람의 화면에서만 쓴다. */
export function useStatsMemory(): StatsMemory {
  const memory = use(StatsMemoryContext)
  if (!memory) throw new Error('로그인한 사람의 화면에서만 쓴다')
  return memory
}
