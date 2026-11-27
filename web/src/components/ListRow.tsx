import type { ReactNode } from 'react'
import Icon, { type IconSvg } from './Icon'
import { CaretRight } from './icons'
import { Link } from './Link'
import styles from './ListRow.module.css'

/** 줄의 묶음. 묶음이 이어지면 사이에 선을 긋는다. */
export function ListGroup({ children }: { children: ReactNode }) {
  return <ul className={styles.group}>{children}</ul>
}

// 모양은 화면에서 덮어쓰지 않는다
interface ListRowProps {
  icon: IconSvg
  children: ReactNode
}

/** 누르면 다른 화면으로 가는 줄 */
export function ListLink({ icon, to, children }: ListRowProps & { to: string }) {
  return (
    <li>
      <Link to={to} className={styles.row}>
        <RowIcon icon={icon} />
        <span className={styles.name}>{children}</span>
        <RowIcon icon={CaretRight} />
      </Link>
    </li>
  )
}

/** 누르면 동작하는 줄. 가는 곳이 없으므로 화살표가 없다. */
export function ListButton({ icon, onClick, children }: ListRowProps & { onClick: () => void }) {
  return (
    <li>
      <button type="button" className={styles.row} onClick={onClick}>
        <RowIcon icon={icon} />
        <span className={styles.name}>{children}</span>
      </button>
    </li>
  )
}

function RowIcon({ icon }: { icon: IconSvg }) {
  return (
    <span className={styles.icon}>
      <Icon icon={icon} size={20} />
    </span>
  )
}
