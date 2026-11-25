import { useState } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import type { MainNavigationItem, Navigation, NavigationItem } from './navigation'

/** 방문 기록의 항목(location.key)마다 그 화면으로 들어온 탭 */
interface TabTrail {
  key?: string
  tab?: MainNavigationItem
  tabByKey: ReadonlyMap<string, MainNavigationItem | undefined>
}

/**
 * 하단 탭에서 강조할 탭(화면설계서 00-common 6.2의 "강조할 탭").
 * 지금 화면으로 들어온 탭이고, 주소로 바로 열어 들어온 탭이 없으면 화면이 속한 탭이다.
 */
export function useCurrentTab(
  { tabs, fallbackTab }: Pick<Navigation, 'tabs' | 'fallbackTab'>,
  screenItem?: NavigationItem,
): MainNavigationItem | undefined {
  const { key, pathname } = useLocation()
  const navigationType = useNavigationType()
  const [trail, setTrail] = useState<TabTrail>({ tabByKey: new Map() })

  if (trail.key === key) return trail.tab

  function enteredTab() {
    const firstScreenTab = tabs.find((tab) => tab.to === pathname)
    if (firstScreenTab) return firstScreenTab
    const groupTab = tabs.find((tab) => tab === screenItem) ?? fallbackTab
    const known = navigationType === 'POP' ? trail.tabByKey.get(key) : trail.tab
    return known ?? groupTab
  }

  const tab = enteredTab()
  setTrail({ key, tab, tabByKey: new Map(trail.tabByKey).set(key, tab) })
  return tab
}
