import { createContext, use } from 'react'
import type { SignIn } from '../features/auth/useLogin'
import type { SignUp } from '../features/auth/useSignup'
import type { Session } from './sessionState'

interface SessionControl {
  session: Session
  /** 로그인한다. 실패하면 ApiError를 던진다. */
  signIn: SignIn
  /** 가입하고 로그인한다. 실패하면 ApiError를 던진다. */
  signUp: SignUp
  /** 로그인 상태를 다시 확인한다. 진행 중인 확인이 있으면 같이 기다린다. */
  retry: () => void
}

export const SessionContext = createContext<SessionControl | undefined>(undefined)

export function useSession(): SessionControl {
  const control = use(SessionContext)
  if (!control) throw new Error('SessionProvider 안에서만 쓴다')
  return control
}
