import { createContext, use } from 'react'

/**
 * 내역(D-01)이 로그인 한 번 동안 기억하는 것. 메모리에만 있고 기기 저장소에 남기지 않는다.
 * 앱의 로그인한 영역이 로그인마다 새로 만들므로 로그아웃하면 사라진다.
 */
export interface ListMemory {
  /** 내역에서 마지막으로 본 달. 주소에 달이 없을 때 연다. */
  month(): string | undefined
  rememberMonth(month: string): void
  /** 거래 입력(D-04)에서 방금 저장한 거래의 id. 저장 뒤 돌아간 첫 화면만 읽는다(내역이면 그 줄을 강조한다). */
  saved(): string | undefined
  rememberSaved(id: string): void
  /** 저장 뒤 돌아간 화면이 그려진 뒤에 부른다. 그 뒤에 연 내역은 강조하지 않는다. */
  forgetSaved(): void
}

export function createListMemory(): ListMemory {
  let month: string | undefined
  let saved: string | undefined
  return {
    month: () => month,
    rememberMonth(next) {
      month = next
    },
    saved: () => saved,
    rememberSaved(next) {
      saved = next
    },
    forgetSaved() {
      saved = undefined
    },
  }
}

export const ListMemoryContext = createContext<ListMemory | undefined>(undefined)

/** 로그인한 사람의 화면에서만 쓴다. */
export function useListMemory(): ListMemory {
  const memory = use(ListMemoryContext)
  if (!memory) throw new Error('로그인한 사람의 화면에서만 쓴다')
  return memory
}
