import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, type Location } from 'react-router'
import { sessionUserId } from '../api/session'
import { ButtonLink } from '../components/Button'
import { forgetLedgerCopies } from '../device/copies'
import { onPendingChanged } from '../device/pendingQueue'
import LoadFailure from '../components/LoadFailure'
import { parseAccounts } from '../features/accounts/accounts'
import { parseCategories } from '../features/categories/categories'
import { CurrentLedgerContext } from '../features/me/CurrentLedgerContext'
import { deviceKey } from '../features/me/deviceKey'
import { useLedgerCopy } from '../features/me/ledgerCopy'
import { useMeCopy } from '../features/me/meCopy'
import { useAutoSend } from '../features/sync/useAutoSend'
import { pendingKey } from '../features/transactions/pendingTransactions'
import { now } from '../lib/clock'
import { useMe } from '../features/me/useMe'
import ListMemoryProvider from './ListMemoryProvider'
import Loading from './Loading'
import PlainLayout from './PlainLayout'
import { createQueryClient } from './queryClient'
import { forgetReturnAddress, rememberReturnAddress } from './returnAddress'
import { useSession } from './SessionContext'
import type { Session } from './sessionState'
import ToastProvider from './ToastProvider'
import { useWelcomeEntry, WELCOME } from './welcomeEntry'

/**
 * 로그인이 필요한 주소의 문. 로그인을 확인하고 내 정보를 받기 전에는 안쪽 화면과 공통 틀을 그리지 않는다.
 * 들어올 때 홈 대신 첫 실행 안내를 띄울지도 여기서 정한다(welcomeEntry).
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
  const { resumed, status } = useSession().session
  const [queryClient] = useState(createSessionQueryClient)
  // 비우면 진행 중인 요청의 결과도 버린다
  useEffect(() => () => queryClient.clear(), [queryClient])
  // 대기열이 바뀌면(이 탭, 다른 탭) 읽어 둔 대기 항목을 버린다. 그 화면이 내려가 있어도 다시 그릴 때 새로 읽는다
  useEffect(
    () => onPendingChanged(() => void queryClient.invalidateQueries({ queryKey: pendingKey(sessionUserId()) })),
    [queryClient],
  )
  // 되살아난 화면을 그대로 열었으면 조회를 다시 보내, 그사이 서버가 로그인을 끝냈으면 바로 안다
  useEffect(() => {
    if (resumed > 0) void queryClient.refetchQueries({ type: 'active' }, { cancelRefetch: false })
  }, [resumed, queryClient])
  // 확인하지 못한 로그인이 같은 사용자로 확인되면 연결 없이 실패한 조회를 서버에서 다시 받는다(화면은 그대로 둔다)
  const unconfirmed = useRef(status === 'unconfirmed')
  useEffect(() => {
    if (status === 'unconfirmed') unconfirmed.current = true
    else if (status === 'signed-in' && unconfirmed.current) {
      unconfirmed.current = false
      void queryClient.refetchQueries({ type: 'active' }, { cancelRefetch: false })
    }
  }, [status, queryClient])
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function Gate() {
  const { session, retry } = useSession()
  const location = useLocation()
  const signedIn = session.status === 'signed-in'
  const me = useMe({ enabled: signedIn })
  // 확인하지 못한 로그인은 그 사용자의 내 정보 사본으로 공통 틀을 그린다. 확인된 뒤에도 서버의 값이 올 때까지 이어 쓴다(#234)
  const meCopy = useMeCopy(session.deviceUser)
  // 1단계에는 장부가 하나다
  const ledger = (me.data ?? meCopy.data ?? undefined)?.ledgers[0]
  const copyMissing = session.status === 'unconfirmed' && (meCopy.isError || meCopy.data === null)
  // 새 거래 입력이 쓸 계좌·카테고리 사본을 미리 읽는다. 확인하지 못한 로그인은 읽을 때까지 기다려 입력이 뼈대 없이 열린다
  const accountsCopy = useLedgerCopy(ledger?.id, 'accounts', parseAccounts)
  const categoriesCopy = useLedgerCopy(ledger?.id, 'categories', parseCategories)
  const copiesPending = session.status === 'unconfirmed' && (accountsCopy.isPending || categoriesCopy.isPending)
  const entry = useWelcomeEntry(ledger)

  // 로그인한 화면이 열렸으면 돌아갈 주소는 쓸 일이 없다
  useEffect(() => {
    if (signedIn) forgetReturnAddress()
  }, [signedIn])

  if (session.status === 'signed-out') return <LoginRedirect session={session} />

  // 로그인이 풀려 쓰던 값을 남기는 중이다. 입력 화면을 내리고 남긴 뒤 로그인 화면으로 간다(#234 C2)
  if (session.ending) {
    return (
      <PlainLayout>
        <Loading />
      </PlainLayout>
    )
  }

  if (session.status === 'unknown' || session.status === 'retrying' || (copyMissing && !ledger)) {
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

  if (ledger && entry !== 'deciding' && !copiesPending) {
    return (
      <CurrentLedgerContext value={ledger}>
        <ToastProvider>
          <AutoSend signedIn={signedIn} />
          <ListMemoryProvider>
            {entry === 'stay' ? <Outlet /> : <Navigate to={entry === 'welcome' ? WELCOME : '/home'} replace />}
          </ListMemoryProvider>
        </ToastProvider>
      </CurrentLedgerContext>
    )
  }

  // 다시 받는 동안에는 isError가 풀리므로 실패한 적이 있는지로 본다
  if (!me.data && me.errorUpdateCount > 0) {
    return (
      <PlainLayout>
        <LoadFailure onRetry={() => void me.refetch()} busy={me.isFetching} />
      </PlainLayout>
    )
  }

  // 내 정보를 기다리는 동안과 안내를 띄울지 정하는 동안은 같은 글이 이어진다
  return (
    <PlainLayout>
      <Loading />
    </PlainLayout>
  )
}

/**
 * 쌓인 입력을 저절로 보낸다(F-105, #235). 토큰이 있는 로그인에서만 보낸다. 확인하지 못한 로그인은 확인된 뒤에 보낸다(architect #235 D).
 */
function AutoSend({ signedIn }: { signedIn: boolean }) {
  useAutoSend(signedIn)
  return null
}

/** 로그인 한 번 동안의 캐시. 장부를 볼 수 없게 된 조회가 오면 그 장부의 사본을 지운다. */
function createSessionQueryClient(): QueryClient {
  const client = createQueryClient({ onLedgerGone: (ledgerId) => forgetLedger(client, ledgerId) })
  return client
}

/** 장부를 볼 수 없게 됐으면 그 장부의 기기 사본을 지운다(security Q4). 읽은 사본도 캐시에서 버린다. */
function forgetLedger(queryClient: QueryClient, ledgerId: string) {
  const user = sessionUserId()
  if (user === undefined) return
  for (const kind of ['accounts', 'categories']) queryClient.removeQueries({ queryKey: deviceKey(user, kind, ledgerId) })
  void forgetLedgerCopies(user, ledgerId, now()).catch(() => {})
}

function LoginRedirect({ session }: { session: Session }) {
  const location = useLocation()
  useEffect(() => leaveAddress(session, location), [session, location])
  const state = session.end === 'ended' ? { sessionEnded: true, draftKept: session.draftKept === true } : null
  return <Navigate to="/login" replace state={state} />
}

/** 로그인한 뒤 돌아오도록 가려던 주소를 기억한다. 사용자가 로그아웃했으면 앞 사용자의 주소를 남기지 않는다. */
function leaveAddress({ end }: Session, location: Location) {
  if (end === 'logged-out') forgetReturnAddress()
  else rememberReturnAddress(location)
}
