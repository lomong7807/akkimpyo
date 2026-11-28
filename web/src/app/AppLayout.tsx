import { useSyncExternalStore, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router'
import { LedgerNameContext } from '../components/LedgerNameContext'
import { isOpenedFromList } from '../components/openedFromList'
import { ShellContext, type ShellParts } from '../components/ShellContext'
import { keyboardShown, onKeyboardChange } from '../components/visibleArea'
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
  /**
   * 화면의 상단 바·머리에 넣는 것(연결 없음 띠, 동기화 상태 표시)과 사이드바 맨 아래 묶음(#235). 공통 틀을 쓰는 곳(LedgerLayout)이
   * 그려서 넘긴다.
   */
  shell?: ShellParts & { sidebarBottom?: ReactNode }
}

/**
 * 공통 틀. 하단 탭(휴대폰 배치)과 사이드바(넓은 화면)를 그린다.
 * 상단 바의 형태는 안쪽 화면이 MainScreen이나 SubScreen으로 고른다.
 * 휴대폰 배치에서 화면 키보드가 올라오면 하단 탭을 숨기고 내려가면 다시 보인다(00-common 6.2, 홈의 한 줄 입력 #233).
 */
export default function AppLayout({ navigation, ledgerName, canWrite = false, onLogout, shell = {} }: AppLayoutProps) {
  const { band, syncStatus, sidebarBottom } = shell
  const { navigationItem: screenItem, fullScreen, entryInPane } = useScreenHandle()
  const { state } = useLocation()
  const screenTabs = navigation.tabs.filter((tab): tab is MainNavigationItem => tab !== QUICK_ENTRY)
  const currentTab = useCurrentTab({ tabs: screenTabs, fallbackTab: navigation.fallbackTab }, screenItem)
  const quickEntry = canWrite ? navigation.quickEntry : undefined
  // 두 칸 화면에 목록이 보이면(전체 화면 입력이 아니거나 그 칸에 연 입력이면) "거래 입력"도 그 오른쪽 칸에 연다
  const quickEntryInPane = entryInPane === true && (!fullScreen || isOpenedFromList(state))
  const keyboard = useSyncExternalStore(onKeyboardChange, keyboardShown)
  const tabs = !fullScreen && !keyboard
  return (
    <div className={tabs ? `${styles.frame} ${styles.withTabs}` : styles.frame}>
      <Sidebar
        items={navigation.sidebar}
        current={screenItem}
        ledgerName={ledgerName}
        quickEntry={quickEntry}
        quickEntryInPane={quickEntryInPane}
        onLogout={onLogout}
        bottom={sidebarBottom}
      />
      <div className={styles.screen}>
        <LedgerNameContext value={ledgerName}>
          <ShellContext value={{ band, syncStatus }}>
            <Outlet />
          </ShellContext>
        </LedgerNameContext>
      </div>
      {tabs && <TabBar tabs={navigation.tabs} current={currentTab} quickEntry={quickEntry} />}
    </div>
  )
}
