import { Link } from 'react-router'
import Icon from '../components/Icon'
import { holdKeyboard } from '../components/keyboardBridge'
import layout from '../components/layout.module.css'
import { QUICK_ENTRY, type MainNavigationItem, type Navigation, type NavigationItem } from './navigation'
import NavigationLink from './NavigationLink'
import styles from './TabBar.module.css'

interface TabBarProps {
  tabs: Navigation['tabs']
  current?: MainNavigationItem
  /** 거래 입력 칸이 여는 곳. 없으면(보기 전용) 그 칸을 두지 않는다. */
  quickEntry?: NavigationItem
}

export default function TabBar({ tabs, current, quickEntry }: TabBarProps) {
  return (
    <nav className={styles.tabBar} aria-label="주 메뉴">
      <ul className={`${layout.contentWidth} ${styles.tabs}`}>
        {tabs.map((tab) => {
          if (tab !== QUICK_ENTRY) {
            return (
              <li key={tab.to}>
                <NavigationLink item={tab} current={tab === current} className={styles.tab}>
                  <Icon name={tab.icon} size={24} />
                  <span className={styles.label}>{tab.label}</span>
                </NavigationLink>
              </li>
            )
          }
          return (
            quickEntry && (
              <li key={QUICK_ENTRY}>
                <QuickEntryCell item={quickEntry} />
              </li>
            )
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * 거래 입력 칸(빠른 입력 버튼, B-03, owner 결정 11). 칸 가운데의 44px 강조색 버튼이고 글자가 없다.
 * 화면이 아니라 거래 입력을 여는 버튼이라 지금 화면 표시(aria-current)를 받지 않는다.
 */
function QuickEntryCell({ item }: { item: NavigationItem }) {
  return (
    <Link to={item.to} aria-label={item.label} className={styles.quickEntry} onClick={holdKeyboard}>
      <Icon name="Plus" size={24} />
    </Link>
  )
}
