import styles from './StatusChip.module.css'

/** 표시 칩(00-common 5.11). 상태를 적은 글자이고 누를 수 없다. */
export default function StatusChip({ children }: { children: string }) {
  return <span className={styles.chip}>{children}</span>
}
