import type { ReactNode } from 'react'
import { ButtonLink } from '../components/Button'
import Icon from '../components/Icon'
import { Plus } from '../components/icons'
import { holdKeyboard } from '../components/keyboardBridge'
import { openedFromList } from '../components/openedFromList'
import type { Navigation, NavigationItem } from './navigation'
import NavigationLink from './NavigationLink'
import styles from './Sidebar.module.css'

interface SidebarProps {
  items: Navigation['sidebar']
  current?: NavigationItem
  ledgerName?: string
  /** "거래 입력" 버튼이 여는 곳. 없으면(보기 전용) 버튼을 두지 않는다. */
  quickEntry?: NavigationItem
  /** 넓은 화면 두 칸 화면의 목록에서 누른 "거래 입력"이라 목록 옆 오른쪽 칸에 연다(00-common 5.5, #244) */
  quickEntryInPane?: boolean
  onLogout: () => void
  /** 맨 아래 묶음(보내지 않은 입력 줄, 마지막으로 맞춘 시각, 6.1). 창 높이가 모자라도 늘 보이게 붙여 둔다 */
  bottom?: ReactNode
}

/** 로그아웃은 1A 동안 여기에 둔다. 프로필(M-02)이 들어오면 그 화면으로 옮긴다. */
export default function Sidebar({
  items,
  current,
  ledgerName,
  quickEntry,
  quickEntryInPane = false,
  onLogout,
  bottom,
}: SidebarProps) {
  return (
    <div className={styles.sidebar}>
      {ledgerName && <p className={styles.ledgerName}>{ledgerName}</p>}
      {/* 장부 이름 아래 전체 폭의 주 버튼(B-03 (4-1), owner 결정 10). 화면이 아니라 여는 버튼이라 강조하지 않는다 */}
      {quickEntry && (
        <div className={styles.quickEntry}>
          <ButtonLink
            kind="primary"
            to={quickEntry.to}
            state={quickEntryInPane ? openedFromList : undefined}
            preventScrollReset={quickEntryInPane}
            onClick={holdKeyboard}
          >
            <span className={styles.quickEntryLabel}>
              <Icon icon={Plus} size={20} />
              {quickEntry.label}
            </span>
          </ButtonLink>
        </div>
      )}
      <nav aria-label="주 메뉴">
        {items.main.length > 0 && (
          <ul className={styles.menu}>
            {items.main.map((item) => (
              <li key={item.to}>
                <NavigationLink item={item} current={item === current} className={styles.row}>
                  <Icon icon={item.icon} size={24} />
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
      {bottom && <div className={styles.bottom}>{bottom}</div>}
    </div>
  )
}
