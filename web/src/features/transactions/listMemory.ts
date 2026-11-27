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
  /**
   * 달력(D-02)에서 옮긴 달을 그 달력을 연 내역의 방문 기록 항목(`listKey`, 그 항목의 location.key)에 넘긴다(D-02 (1),
   * architect #300 B). 넘긴 값은 하나이고 새로 넘기면 바뀐다.
   */
  handOffMonth(listKey: string, month: string): void
  /** 그 항목(`listKey`)에 넘긴 달. 다른 항목이면 없다. 다른 화면을 거쳐 연 내역 주소의 달을 덮지 않게 하기 위해서다. */
  handedMonth(listKey: string): string | undefined
}

export function createListMemory(): ListMemory {
  let month: string | undefined
  let saved: string | undefined
  let handed: { listKey: string; month: string } | undefined
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
    handOffMonth(listKey, next) {
      handed = { listKey, month: next }
    },
    handedMonth: (listKey) => (handed?.listKey === listKey ? handed.month : undefined),
  }
}

export const ListMemoryContext = createContext<ListMemory | undefined>(undefined)

/** 로그인한 사람의 화면에서만 쓴다. */
export function useListMemory(): ListMemory {
  const memory = use(ListMemoryContext)
  if (!memory) throw new Error('로그인한 사람의 화면에서만 쓴다')
  return memory
}
