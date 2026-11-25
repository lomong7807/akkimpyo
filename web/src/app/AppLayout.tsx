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
}

/**
 * 공통 틀. 하단 탭(휴대폰 배치)과 사이드바(넓은 화면)를 그린다.
 * 상단 바의 형태는 안쪽 화면이 MainScreen이나 SubScreen으로 고른다.
 */
export default function AppLayout({ navigation, ledgerName }: AppLayoutProps) {
  const screenItem = useScreenItem()
  const currentTab = useCurrentTab(navigation, screenItem)
  return (
    <div className={styles.frame}>
      <Sidebar items={navigation.sidebar} current={screenItem} ledgerName={ledgerName} />
      <div className={styles.screen}>
        <LedgerNameContext value={ledgerName}>
          <Outlet />
        </LedgerNameContext>
      </div>
      <TabBar tabs={navigation.tabs} current={currentTab} />
    </div>
  )
}

function useScreenItem() {
  const handles = useMatches().map((match) => match.handle as ScreenHandle | undefined)
  return handles.findLast((handle) => handle?.navigationItem)?.navigationItem
}
