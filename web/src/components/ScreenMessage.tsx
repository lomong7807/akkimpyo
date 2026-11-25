import type { ReactNode } from 'react'
import styles from './ScreenMessage.module.css'

interface ScreenMessageProps {
  title: string
  description: string
  /** 설명 아래에 위에서부터 놓는 동작 */
  children: ReactNode
}

/** 내용 대신 안내와 동작을 가운데에 보이는 화면(찾을 수 없음, 불러오지 못함) */
export default function ScreenMessage({ title, description, children }: ScreenMessageProps) {
  return (
    <div className={styles.message}>
      <h1>{title}</h1>
      <p className={styles.description}>{description}</p>
      <div className={styles.actions}>{children}</div>
    </div>
  )
}
