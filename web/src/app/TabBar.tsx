import Icon from '../components/Icon'
import layout from '../components/layout.module.css'
import type { MainNavigationItem } from './navigation'
import NavigationLink from './NavigationLink'
import styles from './TabBar.module.css'

interface TabBarProps {
  tabs: MainNavigationItem[]
  current?: MainNavigationItem
}

export default function TabBar({ tabs, current }: TabBarProps) {
  return (
    <nav className={styles.tabBar} aria-label="주 메뉴">
      <ul className={`${layout.contentWidth} ${styles.tabs}`}>
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavigationLink item={tab} current={tab === current} className={styles.tab}>
              <Icon name={tab.icon} size={24} />
              {tab.label}
            </NavigationLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
