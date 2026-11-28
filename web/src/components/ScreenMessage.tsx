import type { ReactNode } from 'react'
import styles from './ScreenMessage.module.css'

interface ScreenMessageProps {
  title: string
  description: string
  /** 설명 아래의 덧붙임 한 줄(보조 글자색 캡션) */
  note?: string
  /** 화면 이름(h1)이 따로 있는 하위 화면에서는 2다. 모양은 같다. */
  headingLevel?: 1 | 2
  /** 설명 아래에 위에서부터 놓는 동작 */
  children: ReactNode
}

/** 내용 대신 안내와 동작을 가운데에 보이는 화면(찾을 수 없음, 불러오지 못함) */
export default function ScreenMessage({ title, description, note, headingLevel = 1, children }: ScreenMessageProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className={styles.message}>
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.description}>{description}</p>
      {note && <p className={styles.note}>{note}</p>}
      <div className={styles.actions}>{children}</div>
    </div>
  )
}
