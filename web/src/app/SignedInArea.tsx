import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, type Location } from 'react-router'
import { ButtonLink } from '../components/Button'
import LoadFailure from '../components/LoadFailure'
import { CurrentLedgerContext } from '../features/me/CurrentLedgerContext'
import { useMe } from '../features/me/useMe'
import Loading from './Loading'
import PlainLayout from './PlainLayout'
import { createQueryClient } from './queryClient'
import { forgetReturnAddress, rememberReturnAddress } from './returnAddress'
import { useSession } from './SessionContext'
import type { Session } from './sessionState'

/**
 * 로그인이 필요한 주소의 문. 로그인을 확인하고 내 정보를 받기 전에는 안쪽 화면과 공통 틀을 그리지 않는다.
 * 로그인할 때와 로그인이 끝날 때마다 안쪽을 처음부터 다시 만들어, 앞 사용자의 값이 그려지지 않게 한다.
 */
export default function SignedInArea() {
  const { session } = useSession()
  return (
    <SessionData key={session.id}>
      <Gate />
    </SessionData>
  )
}

/**
 * 로그인 한 번 동안의 서버 데이터. 캐시를 로그인마다 새로 만들므로, 앞 사용자의 응답이 늦게 와도
 * 지금 캐시에 들어올 길이 없다.
 */
function SessionData({ children }: { children: ReactNode }) {
  const { resumed } = useSession().session
  const [queryClient] = useState(createQueryClient)
  // 비우면 진행 중인 요청의 결과도 버린다
  useEffect(() => () => queryClient.clear(), [queryClient])
  // 되살아난 화면을 그대로 열었으면 조회를 다시 보내, 그사이 서버가 로그인을 끝냈으면 바로 안다
  useEffect(() => {
    if (resumed > 0) void queryClient.refetchQueries({ type: 'active' }, { cancelRefetch: false })
  }, [resumed, queryClient])
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function Gate() {
  const { session, retry } = useSession()
  const location = useLocation()
  const signedIn = session.status === 'signed-in'
  const me = useMe({ enabled: signedIn })

  // 로그인한 화면이 열렸으면 돌아갈 주소는 쓸 일이 없다
  useEffect(() => {
    if (signedIn) forgetReturnAddress()
  }, [signedIn])

  if (session.status === 'signed-out') return <LoginRedirect session={session} />

  if (session.status === 'unknown' || session.status === 'retrying') {
    return (
      <PlainLayout>
        <LoadFailure onRetry={retry} busy={session.status === 'retrying'}>
          <ButtonLink kind="text" to="/login" replace onClick={() => leaveAddress(session, location)}>
            로그인하러 가기
          </ButtonLink>
        </LoadFailure>
      </PlainLayout>
    )
  }

  if (me.data) {
    // 1단계에는 장부가 하나다
    return (
      <CurrentLedgerContext value={me.data.ledgers[0]}>
        <Outlet />
      </CurrentLedgerContext>
    )
  }

  // 다시 받는 동안에는 isError가 풀리므로 실패한 적이 있는지로 본다
  if (me.errorUpdateCount > 0) {
    return (
      <PlainLayout>
        <LoadFailure onRetry={() => void me.refetch()} busy={me.isFetching} />
      </PlainLayout>
    )
  }

  return (
    <PlainLayout>
      <Loading />
    </PlainLayout>
  )
}

const endedState = { sessionEnded: true }

function LoginRedirect({ session }: { session: Session }) {
  const location = useLocation()
  useEffect(() => leaveAddress(session, location), [session, location])
  return <Navigate to="/login" replace state={session.end === 'ended' ? endedState : null} />
}

/** 로그인한 뒤 돌아오도록 가려던 주소를 기억한다. 사용자가 로그아웃했으면 앞 사용자의 주소를 남기지 않는다. */
function leaveAddress({ end }: Session, location: Location) {
  if (end === 'logged-out') forgetReturnAddress()
  else rememberReturnAddress(location)
}
