import { use, useId, type ReactNode } from 'react'
import { Button } from './Button'
import layout from './layout.module.css'
import { CaretLeft } from './icons'
import { LedgerNameContext } from './LedgerNameContext'
import { SCREEN_TITLE_ID } from './screenTitle'
import { ShellContext } from './ShellContext'
import { InPaneContext, SidePaneContext } from './sidePane'
import { useGoBack } from './useGoBack'
import styles from './Screen.module.css'

interface MainScreenProps {
  children: ReactNode
  /** 넓은 화면에서 가운데 720px로 모으지 않고 내용 영역 전체 폭을 쓴다. 두 칸 화면(홈)만 쓴다(00-common 2.5). */
  fullWidth?: boolean
}

/** 주 화면: 탭의 첫 화면과 N 그룹. 상단 바에 장부 이름을 둔다. */
export function MainScreen({ children, fullWidth = false }: MainScreenProps) {
  const ledgerName = use(LedgerNameContext)
  const { band, syncStatus } = use(ShellContext)
  return (
    <>
      <header className={`${layout.contentWidth} ${styles.topBar} ${styles.ledgerBar}`}>
        {ledgerName && <p className={styles.ledgerName}>{ledgerName}</p>}
        {syncStatus && <div className={styles.sync}>{syncStatus}</div>}
      </header>
      {band}
      <Content fullWidth={fullWidth}>{children}</Content>
    </>
  )
}

interface TitleBarProps {
  title: string
  /** 앞서 본 화면이 없을 때(주소를 바로 연 경우) "뒤로"가 가는 주소 */
  parent: string
  /** 오른쪽 끝에 두는 화면의 글자 버튼 */
  action?: ReactNode
  /** 넓은 화면에서 가운데 720px로 모으지 않고 내용 영역 전체 폭을 쓴다. 두 칸 하위 화면(달력 D-02)만 쓴다(00-common 2.5). */
  fullWidth?: boolean
}

/** 하위 화면: 목록에서 들어간 상세, 설정, 관리 화면. 상단 바에 "뒤로"와 화면 이름을 둔다. */
export function SubScreen({ children, ...titleBarProps }: TitleBarProps & { children: ReactNode }) {
  const inPane = use(InPaneContext)
  const split = use(SidePaneContext) !== undefined
  if (inPane) {
    return (
      <PaneScreen title={titleBarProps.title} action={titleBarProps.action}>
        {children}
      </PaneScreen>
    )
  }
  // 두 칸 화면이면 이름 줄은 두 칸 위에 걸친다
  return (
    <>
      <TitleBar {...titleBarProps} fullWidth={titleBarProps.fullWidth || split} />
      <Content fullWidth={titleBarProps.fullWidth}>{children}</Content>
    </>
  )
}

/**
 * 내용 자리. 넓은 화면의 두 칸 화면(D-01, G-01)이면 내용 영역 전체 폭을 목록 칸과 오른쪽 칸으로 나눈다(00-common 2.5, L-10).
 * 오른쪽 칸은 목록 칸 뒤에 둔다. 초점과 화면 읽기 순서도 목록 다음이다.
 */
function Content({ fullWidth, children }: { fullWidth?: boolean; children: ReactNode }) {
  const pane = use(SidePaneContext)
  if (pane === undefined) return <main className={`${widthOf(fullWidth)} ${styles.content}`}>{children}</main>
  return (
    <main className={`${widthOf(true)} ${styles.content} ${styles.split}`}>
      <div className={styles.listPane}>{children}</div>
      <div className={styles.sidePane}>{pane}</div>
    </main>
  )
}

/** 오른쪽 칸 안의 하위 화면(D-06 넓은 화면). "뒤로" 없이 화면 이름(h2, 목록의 h1 아래)과 화면별 버튼만 머리에 둔다. */
function PaneScreen({ title, action, children }: Pick<TitleBarProps, 'title' | 'action'> & { children: ReactNode }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className={styles.paneScreen}>
      <div className={styles.paneHead}>
        <h2 id={titleId} className={`${styles.title} ${styles.paneTitle}`}>
          {title}
        </h2>
        {action && <div className={styles.action}>{action}</div>}
      </div>
      {children}
    </section>
  )
}

function widthOf(fullWidth = false): string {
  return fullWidth ? `${layout.contentWidth} ${layout.fullWidth}` : layout.contentWidth
}

/** 하위 화면의 상단 바. 내용의 배치가 다른 화면은 이것만 쓴다. */
export function TitleBar({ title, parent, action, fullWidth }: TitleBarProps) {
  const goBack = useGoBack(parent)
  const { band, syncStatus } = use(ShellContext)
  return (
    <>
      <header className={`${widthOf(fullWidth)} ${styles.topBar} ${styles.titleBar}`}>
        <div className={styles.back}>
          <Button kind="icon" icon={CaretLeft} aria-label="뒤로" onClick={goBack} />
        </div>
        {/* 화면이 내용을 바꿔 초점이 갈 곳을 잃으면 제목으로 옮긴다(focusScreenTitle). 탭 순서에는 들지 않는다 */}
        <h1 id={SCREEN_TITLE_ID} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        {/* 화면별 버튼의 왼쪽(6.1). 넓은 화면에서는 사이드바에 있다 */}
        {syncStatus && <div className={`${styles.sync} ${styles.subSync}`}>{syncStatus}</div>}
        {action && <div className={styles.action}>{action}</div>}
      </header>
      {band}
    </>
  )
}
