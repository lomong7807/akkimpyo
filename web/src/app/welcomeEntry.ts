import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useLocation } from 'react-router'
import { accountsQuery } from '../features/accounts/useAccounts'
import { canEdit, type Ledger } from '../features/me/me'
import { useSession } from './SessionContext'

export const WELCOME = '/welcome'
const HOME = '/home'

/** 앱을 이 주소로 열었으면 홈 대신 안내를 띄울지 정한다. */
const homePaths = ['/', HOME, WELCOME]

/**
 * 들어온 곳에서 할 일
 * - deciding: 계좌 목록을 받아 정하는 중이다. 가려던 화면도 안내도 그리지 않는다
 * - welcome: 첫 실행 안내로 보낸다
 * - home: 안내를 열었지만 띄우지 않는다. 홈으로 보낸다
 * - stay: 가려던 화면을 그린다
 */
export type WelcomeEntry = 'deciding' | 'welcome' | 'home' | 'stay'

/**
 * 첫 실행 안내(C-02)를 홈 대신 띄울지 들어올 때 한 번 정한다(F-118). 현재 장부에 계좌가 하나도 없고 편집 이상이면 띄운다.
 * 정하는 때는 둘이다. 로그인·가입 화면을 거쳐 들어온 때(가려던 주소가 있어도 안내가 먼저다)와, 로그인한 채 앱을 /, /home,
 * /welcome으로 연 때다. 로그인한 채 다른 주소를 바로 열면 정하지 않고 그 화면의 빈 상태가 맡는다.
 * 계좌 목록을 불러오지 못하면 계좌가 없는 것으로 보지 않고 가려던 곳으로 간다. 들어온 곳을 떠나면 다시 정하지 않는다.
 * 계좌 목록은 계좌 목록 화면(G-01)과 같은 캐시에 받는다.
 */
export function useWelcomeEntry(ledger: Ledger | undefined): WelcomeEntry {
  const { session } = useSession()
  const { key, pathname } = useLocation()
  // 로그인한 상태로 이 문이 처음 그려졌으면 로그인하지 않은 화면에서 넘어온 것이다
  const [entry] = useState(() => ({ key, pathname, throughSignIn: session.status === 'signed-in' }))
  const asks = entry.throughSignIn || homePaths.includes(entry.pathname)
  const [welcome, setWelcome] = useState<boolean>()
  const needsAccounts = welcome === undefined && asks && ledger !== undefined && canEdit(ledger)
  // 장부를 알기 전과 정한 뒤에는 받지 않는다
  const accounts = useQuery({ ...accountsQuery(ledger?.id ?? ''), enabled: needsAccounts })

  if (welcome === undefined && ledger) {
    const decided = needsAccounts ? decide(accounts.data, accounts.isError) : false
    if (decided !== undefined) setWelcome(decided)
  }

  if (key !== entry.key) return 'stay'
  if (welcome === undefined) return 'deciding'
  const onWelcome = pathname === WELCOME
  if (welcome && !onWelcome) return 'welcome'
  if (!welcome && onWelcome) return 'home'
  return 'stay'
}

function decide(accounts: unknown[] | undefined, failed: boolean): boolean | undefined {
  if (accounts) return accounts.length === 0
  return failed ? false : undefined
}
