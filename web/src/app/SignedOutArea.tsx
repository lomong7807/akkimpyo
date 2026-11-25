import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import PlainLayout from './PlainLayout'
import { readReturnAddress } from './returnAddress'
import { useSession } from './SessionContext'

/**
 * 로그인하지 않은 사람의 화면(로그인, 가입). 확인 결과를 기다리지 않고 연다.
 * 여기서 로그인하면 그 화면이 스스로 옮겨 가고, 이 문은 보내지 않는다.
 */
export default function SignedOutArea() {
  const { key } = useLocation()
  return <Visit key={key} />
}

function Visit() {
  const { session } = useSession()
  const [opened] = useState(session)

  if (opened.status === 'signed-in') return <Navigate to="/home" replace />

  const restoredHere = session.status === 'signed-in' && session.id === opened.id
  if (restoredHere && !session.loginSubmitted) {
    // 앱을 이 주소로 열었으면 로그인한 채 연 것이므로 기억한 주소를 쓰지 않는다
    return <Navigate to={opened.status === 'checking' ? '/home' : readReturnAddress()} replace />
  }

  return <PlainLayout />
}
