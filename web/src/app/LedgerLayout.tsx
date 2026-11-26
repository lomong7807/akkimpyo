import { useEffect } from 'react'
import { useCurrentLedger } from '../features/me/CurrentLedgerContext'
import { canEdit } from '../features/me/me'
import AppLayout from './AppLayout'
import { navigation } from './navigation'
import { preloadWhenIdle } from './preloadWhenIdle'
import { transactionListScreen, transactionNewScreen } from './screens'
import { useLogout } from './useLogout'

/**
 * 현재 장부의 이름을 보이는 공통 틀. 처음 그린 뒤 한가할 때 하단 탭에서 바로 가는 내역과 거래 입력(쓸 수 있을 때)의 코드를
 * 미리 받는다(#251).
 */
export default function LedgerLayout() {
  const ledger = useCurrentLedger()
  const canWrite = canEdit(ledger)
  const { onLogout, dialog } = useLogout()
  useEffect(
    () => preloadWhenIdle(canWrite ? [transactionListScreen, transactionNewScreen] : [transactionListScreen]),
    [canWrite],
  )
  return (
    <>
      <AppLayout navigation={navigation} ledgerName={ledger.name} canWrite={canWrite} onLogout={onLogout} />
      {dialog}
    </>
  )
}
