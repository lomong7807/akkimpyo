import { Outlet, useMatches } from 'react-router'
import { LedgerNameContext } from '../components/LedgerNameContext'
import type { Navigation, ScreenHandle } from './navigation'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import { useCurrentTab } from './useCurrentTab'
import styles from './AppLayout.module.css'

interface AppLayoutProps {
  navigation: Navigation
  ledgerName?: string
  onLogout: () => void
}

/**
 * 공통 틀. 하단 탭(휴대폰 배치)과 사이드바(넓은 화면)를 그린다.
 * 상단 바의 형태는 안쪽 화면이 MainScreen이나 SubScreen으로 고른다.
 */
export default function AppLayout({ navigation, ledgerName, onLogout }: AppLayoutProps) {
  const { navigationItem: screenItem, fullScreen } = useScreenHandle()
  const currentTab = useCurrentTab(navigation, screenItem)
  return (
    <div className={fullScreen ? styles.frame : `${styles.frame} ${styles.withTabs}`}>
      <Sidebar items={navigation.sidebar} current={screenItem} ledgerName={ledgerName} onLogout={onLogout} />
      <div className={styles.screen}>
        <LedgerNameContext value={ledgerName}>
          <Outlet />
        </LedgerNameContext>
      </div>
      {!fullScreen && <TabBar tabs={navigation.tabs} current={currentTab} />}
    </div>
  )
}

/** 안쪽 라우트에 적은 것이 바깥쪽에 적은 것보다 앞선다. */
function useScreenHandle(): ScreenHandle {
  return Object.assign({}, ...useMatches().map((match) => match.handle as ScreenHandle | undefined))
}
