import styles from './DisabledReason.module.css'

/**
 * 버튼을 누를 수 없는 까닭 한 줄(00-common 4.3·4.4, 5.1). 그 버튼 바로 위에 둔다. 생기고 바뀔 때 화면 읽기에 알린다.
 * `text-caption`, `color-text-secondary`.
 */
export default function DisabledReason({ children }: { children: string }) {
  return (
    <p role="status" className={styles.reason}>
      {children}
    </p>
  )
}
