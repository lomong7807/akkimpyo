import { useEffect } from 'react'
import ConnectionBand from '../features/connection/ConnectionBand'
import { watchConnectionBand } from '../features/connection/bandState'
import { useCurrentLedger } from '../features/me/CurrentLedgerContext'
import { canEdit } from '../features/me/me'
import SidebarSync from '../features/sync/SidebarSync'
import SyncStatus from '../features/sync/SyncStatus'
import AppLayout from './AppLayout'
import { navigation } from './navigation'
import { preloadWhenIdle } from './preloadWhenIdle'
import { transactionListScreen, transactionNewScreen } from './screens'
import { useLogout } from './useLogout'

/**
 * 현재 장부의 이름, 연결 없음 띠, 동기화 상태 표시(#235)를 보이는 공통 틀. 처음 그린 뒤 한가할 때 하단 탭에서 바로 가는 내역과 거래 입력(쓸 수 있을 때)의 코드를
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
  // 연결 없음 띠의 2초는 화면을 옮겨도 이어서 센다(#235)
  useEffect(watchConnectionBand, [])
  return (
    <>
      <AppLayout
        navigation={navigation}
        ledgerName={ledger.name}
        canWrite={canWrite}
        onLogout={onLogout}
        shell={SHELL}
      />
      {dialog}
    </>
  )
}

/** 화면의 상단 바·머리에 넣는 것과 사이드바 맨 아래 묶음(00-common 6.1, 6.5). 모두 스스로 상태를 읽는다 */
const SHELL = { band: <ConnectionBand />, syncStatus: <SyncStatus />, sidebarBottom: <SidebarSync /> }
