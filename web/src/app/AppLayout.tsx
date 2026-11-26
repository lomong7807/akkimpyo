import { Outlet } from 'react-router'
import { LedgerNameContext } from '../components/LedgerNameContext'
import { QUICK_ENTRY, type MainNavigationItem, type Navigation } from './navigation'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import { useCurrentTab } from './useCurrentTab'
import { useScreenHandle } from './useScreenHandle'
import styles from './AppLayout.module.css'

interface AppLayoutProps {
  navigation: Navigation
  ledgerName?: string
  /** 거래를 쓸 수 있다(편집 이상). 아니면 하단 탭의 거래 입력 칸과 사이드바의 "거래 입력"을 두지 않는다(B-03). */
  canWrite?: boolean
  onLogout: () => void
}

/**
 * 공통 틀. 하단 탭(휴대폰 배치)과 사이드바(넓은 화면)를 그린다.
 * 상단 바의 형태는 안쪽 화면이 MainScreen이나 SubScreen으로 고른다.
 */
export default function AppLayout({ navigation, ledgerName, canWrite = false, onLogout }: AppLayoutProps) {
  const { navigationItem: screenItem, fullScreen } = useScreenHandle()
  const screenTabs = navigation.tabs.filter((tab): tab is MainNavigationItem => tab !== QUICK_ENTRY)
  const currentTab = useCurrentTab({ tabs: screenTabs, fallbackTab: navigation.fallbackTab }, screenItem)
  const quickEntry = canWrite ? navigation.quickEntry : undefined
  return (
    <div className={fullScreen ? styles.frame : `${styles.frame} ${styles.withTabs}`}>
      <Sidebar
        items={navigation.sidebar}
        current={screenItem}
        ledgerName={ledgerName}
        quickEntry={quickEntry}
        onLogout={onLogout}
      />
      <div className={styles.screen}>
        <LedgerNameContext value={ledgerName}>
          <Outlet />
        </LedgerNameContext>
      </div>
      {!fullScreen && <TabBar tabs={navigation.tabs} current={currentTab} quickEntry={quickEntry} />}
    </div>
  )
}
