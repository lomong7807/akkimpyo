import type { ReactNode } from 'react'
import { useLoadingMessage } from './useLoadingMessage'
import styles from './Skeleton.module.css'

/**
 * 불러오는 동안의 뼈대. 안에는 실제와 같은 줄을 그 화면의 CSS로 놓고 글자 자리에 SkeletonBar를 둔다.
 * 그래야 내용으로 바뀔 때 화면이 밀리지 않는다.
 */
export default function Skeleton({ children }: { children: ReactNode }) {
  const message = useLoadingMessage()
  return (
    <>
      <p role="status" className={styles.announcement}>
        {message}
      </p>
      {message && <div aria-hidden="true">{children}</div>}
    </>
  )
}

interface SkeletonBarProps {
  /** 줄의 왼쪽 이름이나 오른쪽 금액 */
  kind: 'name' | 'amount'
  /** 그 자리에 올 글자 */
  text: 'title' | 'body' | 'label'
}

const kindClasses = { name: styles.name, amount: styles.amount }
const textClasses = { title: styles.title, body: styles.body, label: styles.label }

/** 글자 한 줄 자리의 멈춘 막대. 이름과 금액을 나란히 놓는 줄(flex) 안에 둔다. */
export function SkeletonBar({ kind, text }: SkeletonBarProps) {
  return (
    <span className={`${kindClasses[kind]} ${textClasses[text]}`}>
      <span className={styles.bar} />
    </span>
  )
}
