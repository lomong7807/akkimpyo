import type { SessionEnd } from '../api/session'

/** 이 탭의 로그인 상태 */
export interface Session {
  /**
   * - checking: 서버에 확인하고 있다
   * - unknown: 확인하지 못했거나 답이 늦다. 로그인이 풀린 것이 아니다
   * - retrying: unknown에서 사용자가 다시 확인하고 있다
   * - unconfirmed: 연결 없이 앱을 열어 서버에 확인하지 못한 채 기기의 마지막 로그인 기록으로 열었다(#234). 그 사용자의 사본,
   *   공통 틀, 빠른 입력만 보인다. 같은 사용자로 확인되면 id를 바꾸지 않고 signed-in이 된다
   */
  status: 'checking' | 'unknown' | 'retrying' | 'unconfirmed' | 'signed-out' | 'signed-in'
  /** 로그인할 때와 로그인이 끝날 때마다 바뀐다. 앞 사용자의 화면과 캐시를 이어 쓰지 않게 하는 key다. */
  id: number
  /** 쓰던 로그인이 끝난 까닭. 로그인하지 않은 동안에만 뜻이 있다. */
  end?: 'ended' | 'logged-out'
  /** 로그인이 풀릴 때 열린 입력 화면의 쓰던 값을 이 기기에 남겼다(#234 C2). end가 ended일 때만 뜻이 있다 */
  draftKept?: boolean
  /**
   * 로그인이 풀려 쓰던 값을 남기는 중이다(#234 C2). 값은 이미 꺼냈으므로 입력 화면을 바로 내리고, 남긴 뒤 로그인 화면으로 간다.
   * 그 사이 토큰이 없는 화면이 남아 401로 끝난 저장의 실패 문구를 보이거나 다시 누르지 않게 한다(architect C2 검토)
   */
  ending?: boolean
  /** 로그인을 보냈다. 그 뒤에 오는 확인 결과로는 화면을 옮기지 않는다. */
  loginSubmitted: boolean
  /** 이 로그인 동안 화면이 보관됐다가 되살아난 횟수 */
  resumed: number
  /**
   * 확인하지 못한 로그인으로 연 사용자. 기기 데이터(사본)를 고르는 데만 쓴다. 같은 사용자로 확인돼도 이 로그인 동안 남아,
   * 서버의 값이 올 때까지 사본을 이어 보인다.
   */
  deviceUser?: string
}

export type SessionEvent =
  // 확인의 결과
  | 'restored'
  | 'login-needed'
  | 'check-failed'
  | 'check-late'
  | { type: 'unconfirmed'; user: string }
  // 로그인이 풀렸고 쓰던 값을 남기려 했다(남겼는지)
  | { type: 'ended'; draftKept: boolean }
  // 사용자가 한 것
  | 'retried'
  | 'login-submitted'
  | 'signed-in'
  // 세션 계층이 알린 것
  | SessionEnd
  | 'ending'
  | 'confirmed'
  // 브라우저가 알린 것
  | 'resumed'

export const initialSession: Session = { status: 'checking', id: 0, loginSubmitted: false, resumed: 0 }

export function nextSession(session: Session, event: SessionEvent): Session {
  const anew = { ...initialSession, id: session.id + 1 }
  if (typeof event === 'object' && event.type === 'ended') {
    return { ...anew, status: 'signed-out', end: 'ended', draftKept: event.draftKept }
  }
  if (typeof event === 'object') {
    // 확인하는 사이에 로그인했으면 늦게 온 결과는 쓰지 않는다
    if (session.status === 'signed-in' || session.status === 'signed-out') return session
    return { ...session, status: 'unconfirmed', deviceUser: event.user }
  }
  switch (event) {
    case 'ending':
      return session.status === 'signed-in' || session.status === 'unconfirmed' ? { ...session, ending: true } : session
    case 'confirmed':
      return session.status === 'unconfirmed' ? { ...session, status: 'signed-in' } : session
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
