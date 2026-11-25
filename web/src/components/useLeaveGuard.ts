import { useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router'
import { useGoBack } from './useGoBack'

interface LeaveGuardOptions {
  /** 앞서 본 화면이 없을 때(주소를 바로 연 경우) 닫으면 가는 주소 */
  parent: string
  /** 연 뒤에 바꾼 값이 있다 */
  changed: boolean
  /** 보내는 중이다. 요청이 어디까지 갔는지 모르므로 닫지 않는다. */
  busy: boolean
}

export type LeaveGuard = ReturnType<typeof useLeaveGuard>

/**
 * 전체 화면 입력을 떠나는 길(화면설계서 00-common 5.5). 바꾼 값이 있으면 버릴지 묻는다.
 * 앱 안의 이동은 모두 막으므로 브라우저의 뒤로와 사이드바의 링크도 같다. 로그인이 끝나면 화면이 통째로 빠지므로 막지 않는다.
 */
export function useLeaveGuard({ parent, changed, busy }: LeaveGuardOptions) {
  const goBack = useGoBack(parent)
  const leaving = useRef(false)
  const [asking, setAsking] = useState(false)
  const blocker = useBlocker(() => !leaving.current && (changed || busy))

  useEffect(() => {
    if (blocker.state === 'blocked' && busy) blocker.reset()
  }, [blocker, busy])

  /** 묻지 않고 떠난다. 화면이 바뀌기 전에 또 눌러도 한 번만 떠난다. */
  function leave(go: () => void) {
    if (leaving.current) return
    leaving.current = true
    go()
  }

  return {
    busy,
    /** 버릴지 묻고 있다 */
    asking: !busy && (asking || blocker.state === 'blocked'),
    close() {
      if (busy) return
      if (changed) setAsking(true)
      else leave(goBack)
    },
    keep() {
      setAsking(false)
      blocker.reset?.()
    },
    discard() {
      leave(blocker.state === 'blocked' ? blocker.proceed : goBack)
    },
    leave,
  }
}
