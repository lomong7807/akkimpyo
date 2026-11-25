import { useLocation, useNavigate } from 'react-router'
import LoginPage from '../features/auth/LoginPage'
import { readReturnAddress } from './returnAddress'
import { useSession } from './SessionContext'

/** 로그인 화면을 이 탭의 로그인 상태와 잇는다. */
export default function LoginRoute() {
  const { signIn } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { sessionEnded?: boolean } | null
  return (
    <LoginPage
      signIn={signIn}
      onSignedIn={() => navigate(readReturnAddress(), { replace: true })}
      sessionEnded={state?.sessionEnded === true}
    />
  )
}
