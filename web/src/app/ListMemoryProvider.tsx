import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { createListMemory, ListMemoryContext } from '../features/transactions/listMemory'
import { useScreenHandle } from './useScreenHandle'

/**
 * 내역이 로그인 한 번 동안 기억하는 것(고른 달, 방금 저장한 거래). 로그인한 영역 안에 두어 로그인마다 새로 만든다.
 * 저장한 거래는 저장 뒤 돌아간 첫 화면이 그려진 다음에 잊는다. 그 화면이 내역이면 그리는 동안 이미 읽었다.
 */
export default function ListMemoryProvider({ children }: { children: ReactNode }) {
  const [memory] = useState(createListMemory)
  const { key } = useLocation()
  const { fullScreen } = useScreenHandle()

  // 안쪽 화면의 효과보다 뒤에 돈다
  useEffect(() => {
    if (!fullScreen) memory.forgetSaved()
  }, [key, fullScreen, memory])

  return <ListMemoryContext value={memory}>{children}</ListMemoryContext>
}
