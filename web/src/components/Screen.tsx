import { use, type ReactNode } from 'react'
import { Button } from './Button'
import layout from './layout.module.css'
import { LedgerNameContext } from './LedgerNameContext'
import { useGoBack } from './useGoBack'
import styles from './Screen.module.css'

/** 주 화면: 탭의 첫 화면과 N 그룹. 상단 바에 장부 이름을 둔다. */
export function MainScreen({ children }: { children: ReactNode }) {
  const ledgerName = use(LedgerNameContext)
  return (
    <>
      <header className={`${layout.contentWidth} ${styles.topBar} ${styles.ledgerBar}`}>
        {ledgerName && <p className={styles.ledgerName}>{ledgerName}</p>}
      </header>
      <main className={`${layout.contentWidth} ${styles.content}`}>{children}</main>
    </>
  )
}

interface TitleBarProps {
  title: string
  /** 앞서 본 화면이 없을 때(주소를 바로 연 경우) "뒤로"가 가는 주소 */
  parent: string
  /** 오른쪽 끝에 두는 화면의 글자 버튼 */
  action?: ReactNode
}

/** 하위 화면: 목록에서 들어간 상세, 설정, 관리 화면. 상단 바에 "뒤로"와 화면 이름을 둔다. */
export function SubScreen({ children, ...titleBarProps }: TitleBarProps & { children: ReactNode }) {
  return (
    <>
      <TitleBar {...titleBarProps} />
      <main className={`${layout.contentWidth} ${styles.content}`}>{children}</main>
    </>
  )
}

/** 하위 화면의 상단 바. 내용의 배치가 다른 화면은 이것만 쓴다. */
export function TitleBar({ title, parent, action }: TitleBarProps) {
  const goBack = useGoBack(parent)
  return (
    <header className={`${layout.contentWidth} ${styles.topBar} ${styles.titleBar}`}>
      <div className={styles.back}>
        <Button kind="icon" icon="CaretLeft" aria-label="뒤로" onClick={goBack} />
      </div>
      <h1 className={styles.title}>{title}</h1>
      {action && <div className={styles.action}>{action}</div>}
    </header>
  )
}
