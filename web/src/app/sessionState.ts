import type { SessionEnd } from '../api/session'

/** 이 탭의 로그인 상태 */
export interface Session {
  /**
   * - checking: 서버에 확인하고 있다
   * - unknown: 확인하지 못했거나 답이 늦다. 로그인이 풀린 것이 아니다
   * - retrying: unknown에서 사용자가 다시 확인하고 있다
   */
  status: 'checking' | 'unknown' | 'retrying' | 'signed-out' | 'signed-in'
  /** 로그인할 때와 로그인이 끝날 때마다 바뀐다. 앞 사용자의 화면과 캐시를 이어 쓰지 않게 하는 key다. */
  id: number
  /** 쓰던 로그인이 끝난 까닭. 로그인하지 않은 동안에만 뜻이 있다. */
  end?: 'ended' | 'logged-out'
  /** 로그인을 보냈다. 그 뒤에 오는 확인 결과로는 화면을 옮기지 않는다. */
  loginSubmitted: boolean
  /** 이 로그인 동안 화면이 보관됐다가 되살아난 횟수 */
  resumed: number
}

export type SessionEvent =
  // 확인의 결과
  | 'restored'
  | 'login-needed'
  | 'check-failed'
  | 'check-late'
  // 사용자가 한 것
  | 'retried'
  | 'login-submitted'
  | 'signed-in'
  // 세션 계층이 알린 것
  | SessionEnd
  // 브라우저가 알린 것
  | 'resumed'

export const initialSession: Session = { status: 'checking', id: 0, loginSubmitted: false, resumed: 0 }

export function nextSession(session: Session, event: SessionEvent): Session {
  const anew = { ...initialSession, id: session.id + 1 }
  switch (event) {
    case 'signed-in':
      return { ...anew, status: 'signed-in' }
    case 'ended':
    case 'logged-out':
      return { ...anew, status: 'signed-out', end: event }
    case 'replaced':
      return { ...anew, status: 'checking' }
    case 'replaced-after-logout':
      return { ...anew, status: 'checking', end: 'logged-out' }
    case 'login-submitted':
      return { ...session, loginSubmitted: true }
    case 'resumed':
      return { ...session, resumed: session.resumed + 1 }
  }
  // 확인하는 사이에 로그인했으면 늦게 온 결과는 쓰지 않는다
  if (session.status === 'signed-in' || session.status === 'signed-out') return session
  return { ...session, status: statusAfter[event] }
}

const statusAfter = {
  restored: 'signed-in',
  'login-needed': 'signed-out',
  'check-failed': 'unknown',
  'check-late': 'unknown',
  retried: 'retrying',
} as const
