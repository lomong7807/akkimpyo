import { useEffect, useLayoutEffect, useReducer, type ReactNode } from 'react'
import { TIMEOUT_MS } from '../api/http'
import { login, onSessionEnded, resendLogout, restoreSession, signup } from '../api/session'
import type { SignIn } from '../features/auth/useLogin'
import type { SignUp } from '../features/auth/useSignup'
import { initialSession, nextSession, type SessionEvent } from './sessionState'
import { SessionContext } from './SessionContext'
import { uncoverPage, watchSession } from './sessionWatch'

/** 이 탭의 로그인 상태를 세션 계층과 맞춘다. 로그인 상태를 되찾는 호출은 여기에만 있다. */
export default function SessionProvider({ children }: { children: ReactNode }) {
  const [session, dispatch] = useReducer(nextSession, initialSession)
  const waiting = session.status === 'checking' || session.status === 'retrying'

  useEffect(() => {
    const check = () => void checkSession().then(dispatch)
    const stopListening = onSessionEnded((end) => {
      dispatch(end)
      if (end === 'replaced') check()
    })
    const stopWatching = watchSession(() => dispatch('resumed'))
    // 서버에 닿지 못한 로그아웃은 앱을 열 때와 다시 연결될 때만 또 보낸다
    resendLogout()
    check()
    return () => {
      stopListening()
      stopWatching()
    }
  }, [])

  // 되살아난 화면은 앞 사용자의 화면을 버렸거나 그대로 써도 되는 것이 그려진 뒤에 연다
  useLayoutEffect(uncoverPage, [session.id, session.resumed])

  // 늦어도 확인은 끊지 않는다. 그 뒤에 결과가 오면 그때 쓴다
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => dispatch('check-late'), TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [waiting])

  const signIn: SignIn = async (values) => {
    dispatch('login-submitted')
    await login(values)
    dispatch('signed-in')
  }

  const signUp: SignUp = async (account) => {
    dispatch('login-submitted')
    await signup(account)
    dispatch('signed-in')
  }

  function retry() {
    dispatch('retried')
    void checkSession().then(dispatch)
  }

  return <SessionContext value={{ session, signIn, signUp, retry }}>{children}</SessionContext>
}

/** 진행 중인 확인이 있으면 새로 보내지 않고 그 결과를 같이 받는다(api/session의 renew). */
async function checkSession(): Promise<SessionEvent> {
  try {
    return (await restoreSession()) ? 'restored' : 'login-needed'
  } catch {
    return 'check-failed'
  }
}
