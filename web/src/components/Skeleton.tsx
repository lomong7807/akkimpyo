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
      <LoadingStatus message={message} />
      {message && <div aria-hidden="true">{children}</div>}
    </>
  )
}

/**
 * 화면 읽기에만 "불러오고 있어요."를 알리는 곳. 뼈대가 실제 내용(소제목 등) 사이에 나뉜 화면은
 * useLoadingMessage의 글을 이것 하나에 넘기고 뼈대는 SkeletonSpace로 나눠 둔다.
 */
export function LoadingStatus({ message }: { message: string | undefined }) {
  return (
    <p role="status" className={styles.announcement}>
      {message}
    </p>
  )
}

/**
 * 아래에 다른 내용이 있는 뼈대 자리. 300ms 전에도 같은 자리를 비워 두어, 뼈대가 나타날 때 아래 내용이 밀리지 않는다.
 * `shown`은 useLoadingMessage의 글이 있는지다.
 */
export function SkeletonSpace({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <div aria-hidden="true" className={shown ? undefined : styles.reserved}>
      {children}
    </div>
  )
}

interface SkeletonBarProps {
  /** 줄의 왼쪽 이름이나 오른쪽 금액 */
  kind: 'name' | 'amount'
  /** 그 자리에 올 글자 */
  text: 'hero' | 'title' | 'body' | 'label'
}

const kindClasses = { name: styles.name, amount: styles.amount }
const textClasses = { hero: styles.hero, title: styles.title, body: styles.body, label: styles.label }

/** 글자 한 줄 자리의 멈춘 막대. 이름과 금액을 나란히 놓는 줄(flex) 안에 둔다. */
export function SkeletonBar({ kind, text }: SkeletonBarProps) {
  return (
    <span className={`${kindClasses[kind]} ${textClasses[text]}`}>
      <span className={styles.bar} />
    </span>
  )
}
