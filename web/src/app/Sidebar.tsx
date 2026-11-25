import Icon from '../components/Icon'
import type { Navigation, NavigationItem } from './navigation'
import NavigationLink from './NavigationLink'
import styles from './Sidebar.module.css'

interface SidebarProps {
  items: Navigation['sidebar']
  current?: NavigationItem
  ledgerName?: string
  onLogout: () => void
}

/** 로그아웃은 1A 동안 여기에 둔다. 프로필(M-02)이 들어오면 그 화면으로 옮긴다. */
export default function Sidebar({ items, current, ledgerName, onLogout }: SidebarProps) {
  return (
    <div className={styles.sidebar}>
      {ledgerName && <p className={styles.ledgerName}>{ledgerName}</p>}
      <nav aria-label="주 메뉴">
        {items.main.length > 0 && (
          <ul className={styles.menu}>
            {items.main.map((item) => (
              <li key={item.to}>
                <NavigationLink item={item} current={item === current} className={styles.row}>
                  <Icon name={item.icon} size={24} />
                  {item.label}
                </NavigationLink>
              </li>
            ))}
          </ul>
        )}
        {items.more.length > 0 && (
          <ul className={`${styles.menu} ${styles.more}`}>
            {items.more.map((item) => (
              <li key={item.to}>
                <NavigationLink item={item} current={item === current} className={styles.row}>
                  {item.label}
                </NavigationLink>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.logout}>
          <button type="button" className={styles.row} onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </nav>
    </div>
  )
}
