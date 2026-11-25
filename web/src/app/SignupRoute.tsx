import { useLocation, useNavigate } from 'react-router'
import SignupPage from '../features/auth/SignupPage'
import { passedEmail } from './passedEmail'
import { useSession } from './SessionContext'

/** 가입 화면을 이 탭의 로그인 상태와 잇는다. */
export default function SignupRoute() {
  const { signUp } = useSession()
  const navigate = useNavigate()
  const { state } = useLocation()
  return (
    <SignupPage
      signUp={signUp}
      onSignedUp={() => navigate('/welcome', { replace: true })}
      initialEmail={passedEmail(state)}
    />
  )
}
