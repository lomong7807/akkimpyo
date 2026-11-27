import styles from './StatusChip.module.css'

interface StatusChipProps {
  children: string
  /**
   * 사용자가 만든 이름처럼 길 수 있는 글자. 놓인 칸보다 길면 줄을 바꾸고 높이가 늘어난다.
   * 한 줄이면 보통 칩과 같다. 상태를 적은 짧은 글자("기본" 등)에는 쓰지 않는다.
   */
  wrap?: boolean
  /** 오류 칩("보낼 수 없음"). `color-surface` 바탕, 1px `color-danger` 테두리, `color-danger` 글자다(00-common 5.11) */
  danger?: boolean
}

/** 표시 칩(00-common 5.11). 상태나 이름을 적은 글자이고 누를 수 없다. */
export default function StatusChip({ children, wrap = false, danger = false }: StatusChipProps) {
  const className = [styles.chip, wrap && styles.wrap, danger && styles.danger].filter(Boolean).join(' ')
  return <span className={className}>{children}</span>
}
