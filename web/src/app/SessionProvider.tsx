import { useEffect, useLayoutEffect, useReducer, type ReactNode } from 'react'
import { onConnectionChange, watchConnection } from '../api/connection'
import { TIMEOUT_MS } from '../api/http'
import {
  confirmSession,
  login,
  onSessionConfirmed,
  onSessionEnded,
  onSessionEnding,
  openUnconfirmed,
  resendLogout,
  restoreSession,
  signup,
} from '../api/session'
import { sweepExpiredCopies } from '../device/copies'
import { sweepExpiredDrafts } from '../device/drafts'
import { askToKeepStorage } from '../device/persistence'
import type { SignIn } from '../features/auth/useLogin'
import type { SignUp } from '../features/auth/useSignup'
import { keepOpenDrafts } from '../features/drafts/keepDraft'
import { readMeCopy } from '../features/me/meCopy'
import { now } from '../lib/clock'
import { refetchOnReconnect } from './queryClient'
import { initialSession, nextSession, type SessionEvent } from './sessionState'
import { SessionContext } from './SessionContext'
import { uncoverPage, watchSession } from './sessionWatch'

/** 이 탭의 로그인 상태를 세션 계층과 맞춘다. 로그인 상태를 되찾는 호출은 여기에만 있다. */
export default function SessionProvider({ children }: { children: ReactNode }) {
  const [session, dispatch] = useReducer(nextSession, initialSession)
  const waiting = session.status === 'checking' || session.status === 'retrying'
  const status = session.status

  useEffect(() => {
    const check = () => void checkSession().then(dispatch)
    // 로그인이 풀리기 직전에 열린 입력 화면의 쓰던 값을 남기기 시작하고, 남긴 뒤에 로그인 화면으로 보낸다(#234 C2)
    let keeping: Promise<boolean> | undefined
    const stopEnding = onSessionEnding((userId) => {
      keeping = keepOpenDrafts(userId, now())
      if (keeping) dispatch('ending')
    })
    const stopListening = onSessionEnded((end) => {
      const kept = end === 'ended' ? keeping : undefined
      keeping = undefined
      if (kept) {
        void kept.then((draftKept) => dispatch({ type: 'ended', draftKept }))
        return
      }
      dispatch(end)
      if (end === 'replaced' || end === 'replaced-after-logout') check()
    })
    const stopConfirmed = onSessionConfirmed(() => dispatch('confirmed'))
    const stopWatching = watchSession(() => dispatch('resumed'))
    const stopConnection = watchConnection()
    const stopRefetching = refetchOnReconnect()
    // 마지막으로 확인한 로그인부터 30일이 지난 사본과, 남긴 때부터 30일이 지난 쓰던 값은 앱을 열 때 지운다(security 권고)
    void sweepExpiredCopies(now()).catch(() => {})
    void sweepExpiredDrafts(now()).catch(() => {})
    // 서버에 닿지 못한 로그아웃은 앱을 열 때와 다시 연결될 때만 또 보낸다
    resendLogout()
    check()
    return () => {
      stopEnding()
      stopListening()
      stopConfirmed()
      stopWatching()
      stopConnection()
      stopRefetching()
    }
  }, [])

  // 확인하지 못한 로그인은 연결이 돌아오면 다른 요청보다 먼저 확인한다(결정 댓글)
  useEffect(() => {
    if (status !== 'unconfirmed') return
    return onConnectionChange((next) => {
      if (next === 'online') void confirmSession().catch(() => {})
    })
  }, [status])

  // 기기에 남기는 것이 생기므로 브라우저에 저장 유지를 요청한다(ADR 006 결정 7)
  useEffect(() => {
    if (status === 'signed-in' || status === 'unconfirmed') void askToKeepStorage()
  }, [status])

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

/**
 * 진행 중인 확인이 있으면 새로 보내지 않고 그 결과를 같이 받는다(api/session의 renew).
 * 갱신이 연결 없음과 같은 실패면 기기의 마지막 로그인 기록으로 '확인하지 못한 로그인'으로 열 수 있는지 본다. 그 사용자의
 * 내 정보 사본이 있어야 공통 틀을 그릴 수 있다.
 */
async function checkSession(): Promise<SessionEvent> {
  try {
    return (await restoreSession()) ? 'restored' : 'login-needed'
  } catch (error) {
    const user = await openUnconfirmed(error, hasMeCopy)
    return user === undefined ? 'check-failed' : { type: 'unconfirmed', user }
  }
}

async function hasMeCopy(userId: string): Promise<boolean> {
  try {
    return (await readMeCopy(userId)) !== undefined
  } catch {
    return false
  }
}
