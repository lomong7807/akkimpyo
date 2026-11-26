import { logout } from '../api/session'
import { useCurrentLedger } from '../features/me/CurrentLedgerContext'
import { canEdit } from '../features/me/me'
import AppLayout from './AppLayout'
import { navigation } from './navigation'

/** 현재 장부의 이름을 보이는 공통 틀 */
export default function LedgerLayout() {
  const ledger = useCurrentLedger()
  return (
    <AppLayout
      navigation={navigation}
      ledgerName={ledger.name}
      canWrite={canEdit(ledger)}
      onLogout={logout}
    />
  )
}
