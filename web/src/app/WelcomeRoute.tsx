import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate } from 'react-router'
import { accountsQuery } from '../features/accounts/useAccounts'
import { useCurrentLedger } from '../features/me/CurrentLedgerContext'
import { canEdit } from '../features/me/me'
import WelcomePage from '../features/welcome/WelcomePage'
import Loading from './Loading'
import PlainLayout from './PlainLayout'

/**
 * 첫 실행 안내를 연 뒤의 판단. 계좌가 이미 있거나 편집할 수 없는 사람이면 /home으로 보낸다
 * (계좌를 만든 뒤 뒤로 가 다시 연 경우 등). 들어올 때의 판단은 장부에 속한 화면의 문(welcomeEntry)이 한다.
 */
export default function WelcomeRoute() {
  const ledger = useCurrentLedger()
  // 문이 판단하며 받은 목록을 그대로 쓴다. 캐시에 없을 때만 받는다
  const accounts = useQuery({ ...accountsQuery(ledger.id), staleTime: Infinity })
  // 연 때 한 번만 본다. 안내가 만든 계좌로 바뀐 목록으로는 옮기지 않는다
  const [hadAccounts, setHadAccounts] = useState<boolean>()
  if (hadAccounts === undefined && accounts.data) setHadAccounts(accounts.data.length > 0)

  // 불러오지 못한 것을 계좌 없음으로 보지 않는다
  if (!canEdit(ledger) || hadAccounts || (hadAccounts === undefined && accounts.isError)) {
    return <Navigate to="/home" replace />
  }

  if (hadAccounts === undefined) {
    return (
      <PlainLayout>
        <Loading />
      </PlainLayout>
    )
  }

  return <WelcomePage />
}
