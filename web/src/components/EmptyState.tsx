import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  description: string
  /** 채우러 가는 주 버튼. 권할 것이 없으면 두지 않는다. */
  children?: ReactNode
}

/** 데이터 없음(화면설계서 00-common 4.2). 목록이나 내용이 놓일 자리에 둔다. */
export default function EmptyState({ description, children }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.description}>{description}</p>
      {children && <div className={styles.action}>{children}</div>}
    </div>
  )
}
