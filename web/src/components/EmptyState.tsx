import styles from './EmptyState.module.css'

/** 데이터 없음(화면설계서 00-common 4.2). 목록이나 내용이 놓일 자리에 둔다. */
export default function EmptyState({ description }: { description: string }) {
  return (
    <div className={styles.empty}>
      <p className={styles.description}>{description}</p>
    </div>
  )
}
