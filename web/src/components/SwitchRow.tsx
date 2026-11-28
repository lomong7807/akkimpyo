import { Link } from './Link'
import styles from './SwitchRow.module.css'

export interface SwitchItem {
  /** 칸의 글자 하나 */
  label: string
  /** 그 칸의 화면 주소 */
  to: string
}

interface SwitchRowProps {
  /** 줄의 이름(내비게이션의 접근성 이름) */
  label: string
  /** 칸. 적은 순서대로 놓인다 */
  items: SwitchItem[]
  /** 지금 화면의 칸 글자 */
  current: string
}

/**
 * 전환 줄(00-common 5.11, docs/design/components.md 4절). 같은 묶음의 화면 사이를 옮기는 줄에만 쓴다(designer 결정 2026-11-26).
 * 지출·수입처럼 화면을 옮기지 않는 고르기는 두 칸 고르기(SegmentedChoice)다. 칸이 하나뿐이면 옮겨 갈 곳이 없어 그리지 않는다
 * (designer #242). 칸이 줄 폭을 넘으면 가로로 밀어 본다.
 */
export default function SwitchRow({ label, items, current }: SwitchRowProps) {
  if (items.length < 2) return null
  return (
    <nav aria-label={label}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.to}>
            <Link to={item.to} aria-current={item.label === current ? 'page' : undefined} className={styles.cell}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
